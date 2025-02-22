// src/services/langchain-pdf-processor.ts
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/database";
import type { TrainingDocument } from "../types/training";
import fs from "fs/promises";
import path from "path";

interface LangChainPDFProcessorConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  enableLogging?: boolean;
}

export class LangChainPDFProcessor {
  private readonly config: Required<LangChainPDFProcessorConfig>;
  private readonly textSplitter: RecursiveCharacterTextSplitter;

  constructor(config?: LangChainPDFProcessorConfig) {
    this.config = {
      chunkSize: config?.chunkSize ?? 1000,
      chunkOverlap: config?.chunkOverlap ?? 200,
      enableLogging: config?.enableLogging ?? true,
    };

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
    });
  }

  private log(
    message: string,
    level: "info" | "warn" | "error" = "info"
  ): void {
    if (this.config.enableLogging) {
      switch (level) {
        case "error":
          console.error(message);
          break;
        case "warn":
          console.warn(message);
          break;
        default:
          console.log(message);
      }
    }
  }

  async processPDF(filePath: string): Promise<TrainingDocument> {
    try {
      this.log(`Starting PDF processing for file: ${filePath}`);
      await this.validateFile(filePath);

      const loader = new PDFLoader(filePath, {
        splitPages: false,
      });
      const docs = await loader.load();

      if (!docs.length) {
        throw new Error("No content extracted from PDF");
      }

      const fullContent = docs[0].pageContent;
      const chunks = await this.textSplitter.splitText(fullContent);

      const document: TrainingDocument = {
        id: uuidv4(),
        source: filePath,
        content: fullContent,
        metadata: {
          title: path.basename(filePath),
          fileType: "pdf",
          date: new Date(),
          ...docs[0].metadata,
        },
        chunks,
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
      this.log("File exists and is accessible");
    } catch {
      throw new Error(
        `PDF file does not exist or is not accessible at path: ${filePath}`
      );
    }
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
      this.log(`Successfully saved document ${document.id} to database`);
    } catch (error) {
      throw new Error(`Failed to save document to database: ${error}`);
    }
  }

  async processPDFs(filePaths: string[]): Promise<TrainingDocument[]> {
    this.log(`Starting to process ${filePaths.length} PDFs`);

    const results: TrainingDocument[] = [];
    const errors: { path: string; error: string }[] = [];

    for (const filePath of filePaths) {
      try {
        const document = await this.processPDF(filePath);
        results.push(document);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ path: filePath, error: message });
        this.log(`Failed to process ${filePath}: ${message}`, "error");
      }
    }

    this.logProcessingResults(results.length, errors);
    return results;
  }

  private logProcessingResults(
    successCount: number,
    errors: { path: string; error: string }[]
  ): void {
    this.log(
      `Processing completed:
      - Successful: ${successCount}
      - Failed: ${errors.length}
      ${errors.length > 0 ? "\nFailed files:" : ""}`
    );

    if (errors.length > 0) {
      errors.forEach(({ path, error }) =>
        this.log(`- ${path}: ${error}`, "error")
      );
    }
  }
}
