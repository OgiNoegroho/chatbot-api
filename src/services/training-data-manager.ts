import { pool } from "../config/database";
import { PDFProcessorService } from "./pdfprocessor";
import { WebScraperService } from "./webscraper";

// src/services/training-data-manager.ts
export class TrainingDataManager {
  private webScraper: WebScraperService;
  private pdfProcessor: PDFProcessorService;

  constructor() {
    this.webScraper = new WebScraperService();
    this.pdfProcessor = new PDFProcessorService();
  }

  async processWebsites(urls: string[]): Promise<TrainingDocument[]> {
    const documents: TrainingDocument[] = [];
    for (const url of urls) {
      try {
        const document = await this.webScraper.scrapeWebsite(url);
        documents.push(document);
      } catch (error) {
        console.error(`Failed to process URL: ${url}`, error);
      }
    }
    return documents;
  }

  async processPDFs(filePaths: string[]): Promise<TrainingDocument[]> {
    const documents: TrainingDocument[] = [];
    for (const filePath of filePaths) {
      try {
        const document = await this.pdfProcessor.processPDF(filePath);
        documents.push(document);
      } catch (error) {
        console.error(`Failed to process PDF: ${filePath}`, error);
      }
    }
    return documents;
  }

  async getTrainingDocuments(): Promise<TrainingDocument[]> {
    const result = await pool.query(
      "SELECT * FROM training_documents ORDER BY created_at DESC"
    );
    return result.rows;
  }
}
