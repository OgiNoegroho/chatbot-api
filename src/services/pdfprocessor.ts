// src/services/pdfprocessor.ts

import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/database";
import type { TrainingDocument } from "../types/training";
import path from "path";
import * as pdfjs from "pdfjs-dist";

// IMPORTANT: Update the worker configuration
if (typeof window === "undefined") {
  // Node.js environment
  const pdfjsWorker = require("pdfjs-dist/build/pdf.worker.js");
  if (!(globalThis as any).pdfjsWorker) {
    (globalThis as any).pdfjsWorker = pdfjsWorker;
  }
} else {
  // Browser environment
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface PDFProcessorConfig {
  maxChunkSize: number;
  minChunkSize?: number;
  enableLogging?: boolean;
}

export class PDFProcessorService {
  private readonly config: PDFProcessorConfig;
  private readonly logger: (
    message: string,
    level?: "info" | "warn" | "error"
  ) => void;

  constructor(config: PDFProcessorConfig) {
    this.config = {
      maxChunkSize: config.maxChunkSize,
      minChunkSize: config.minChunkSize || 100,
      enableLogging: config.enableLogging ?? true,
    };

    this.logger = (
      message: string,
      level: "info" | "warn" | "error" = "info"
    ) => {
      if (this.config.enableLogging) {
        switch (level) {
          case "warn":
            console.warn(message);
            break;
          case "error":
            console.error(message);
            break;
          default:
            console.log(message);
        }
      }
    };
  }

  async processPDF(filePath: string): Promise<TrainingDocument> {
    try {
      this.logger(`Starting PDF processing for file: ${filePath}`);
      await this.validateFile(filePath);

      const pdfBytes = await fs.readFile(filePath);
      const fileName = path.basename(filePath);
      const content = await this.extractTextFromPDF(pdfBytes);

      if (!content) {
        throw new Error("No text content extracted from PDF");
      }

      const document: TrainingDocument = {
        id: uuidv4(),
        source: filePath,
        content,
        metadata: {
          title: fileName,
          fileType: "pdf",
          date: new Date(),
        },
        chunks: this.chunkContent(content),
        created_at: new Date(),
      };

      await this.saveDocument(document);
      return document;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to process PDF: ${filePath} - ${message}`);
    }
  }

  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
      this.logger("File exists and is accessible");
    } catch {
      throw new Error(
        `PDF file does not exist or is not accessible at path: ${filePath}`
      );
    }
  }

  private async extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
    try {
      const pdfData = new Uint8Array(pdfBuffer);
      const loadingTask = pdfjs.getDocument({
        data: pdfData,
        useWorkerFetch: false,
        isEvalSupported: false,
        disableFontFace: true,
      });

      const pdf = await loadingTask.promise;
      this.logger(`PDF loaded successfully. Number of pages: ${pdf.numPages}`);

      const pageTexts = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) =>
          this.extractPageText(pdf, i + 1)
        )
      );

      return pageTexts.join(" ").replace(/\s+/g, " ").trim();
    } catch (error) {
      this.logger(`Error in extractTextFromPDF: ${error}`, "error");
      throw error;
    }
  }

  private async extractPageText(pdf: any, pageNum: number): Promise<string> {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      return textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
    } catch (error) {
      this.logger(
        `Error extracting text from page ${pageNum}: ${error}`,
        "error"
      );
      return "";
    }
  }

  private chunkContent(content: string): string[] {
    if (!content?.trim()) {
      return [];
    }

    const chunks: string[] = [];
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];

    if (sentences.length === 0) {
      return this.createFixedSizeChunks(content);
    }

    let currentChunk = "";

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= this.config.maxChunkSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length >= this.config.minChunkSize!) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk.length >= this.config.minChunkSize!) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private createFixedSizeChunks(content: string): string[] {
    return Array.from(
      { length: Math.ceil(content.length / this.config.maxChunkSize) },
      (_, i) =>
        content
          .substring(
            i * this.config.maxChunkSize,
            (i + 1) * this.config.maxChunkSize
          )
          .trim()
    );
  }

  private async saveDocument(document: TrainingDocument): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO chatbot.training_documents 
         (id, source, content, metadata, chunks, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          document.id,
          document.source,
          document.content,
          document.metadata,
          document.chunks,
          document.created_at,
        ]
      );
      this.logger(`Successfully saved document ${document.id} to database`);
    } catch (error) {
      throw new Error(`Failed to save document to database: ${error}`);
    }
  }
}