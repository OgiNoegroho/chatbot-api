// src/services/pdfprocessor.ts
import { PDFDocument } from "pdf-lib";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/database";

export class PDFProcessorService {
  private readonly maxChunkSize = 1000; // characters per chunk

  async processPDF(filePath: string): Promise<TrainingDocument> {
    try {
      const pdfBytes = await fs.readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const metadata = pdfDoc.getTitle() || "";

      // Extract text from each page
      let content = "";
      const pageCount = pdfDoc.getPageCount();

      for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        const text = await this.extractPageText(page);
        content += text + " ";
      }

      content = content.replace(/\s+/g, " ").trim();

      const document: TrainingDocument = {
        id: uuidv4(),
        source: filePath,
        content,
        metadata: {
          title: metadata,
          fileType: "pdf",
          date: new Date(),
        },
        chunks: this.chunkContent(content),
        created_at: new Date(),
      };

      await this.saveDocument(document);
      return document;
    } catch (error) {
      console.error("PDF processing error:", error);
      throw new Error(`Failed to process PDF: ${filePath}`);
    }
  }

  private async extractPageText(page: any): Promise<string> {
    // Note: pdf-lib doesn't provide text extraction
    // In a production environment, you might want to use pdf.js or other libraries
    // This is a placeholder for the text extraction logic
    return ""; // Replace with actual text extraction
  }

  private chunkContent(content: string): string[] {
    const chunks: string[] = [];
    let currentChunk = "";
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= this.maxChunkSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  private async saveDocument(document: TrainingDocument): Promise<void> {
    await pool.query(
      `INSERT INTO training_documents 
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
  }
}
