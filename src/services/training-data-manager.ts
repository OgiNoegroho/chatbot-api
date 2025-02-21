// src/services/training-data-manager.ts

import { pool } from "../config/database";
import { PDFProcessorService } from "./pdfprocessor";
import { WebScraperService } from "./webscraper";
import type { TrainingDocument } from "../types/training";

interface ProcessingResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  source: string;
}

interface TrainingDataManagerConfig {
  concurrentProcessing?: number;
  enableLogging?: boolean;
  retryAttempts?: number;
  retryDelay?: number; // milliseconds
}

export class TrainingDataManager {
  private readonly webScraper: WebScraperService;
  private readonly pdfProcessor: PDFProcessorService;
  private readonly config: Required<TrainingDataManagerConfig>;

  constructor(config?: TrainingDataManagerConfig) {
    this.config = {
      concurrentProcessing: config?.concurrentProcessing ?? 3,
      enableLogging: config?.enableLogging ?? true,
      retryAttempts: config?.retryAttempts ?? 2,
      retryDelay: config?.retryDelay ?? 1000,
    };

    this.webScraper = new WebScraperService();
    this.pdfProcessor = new PDFProcessorService({
      maxChunkSize: 1000,
      enableLogging: this.config.enableLogging,
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

  private async retryOperation<T>(
    operation: () => Promise<T>,
    source: string
  ): Promise<ProcessingResult<T>> {
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const data = await operation();
        return { success: true, data, source };
      } catch (error) {
        if (attempt === this.config.retryAttempts) {
          this.log(
            `Failed to process ${source} after ${attempt} attempts: ${error}`,
            "error"
          );
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            source,
          };
        }
        this.log(
          `Attempt ${attempt} failed for ${source}, retrying...`,
          "warn"
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelay)
        );
      }
    }
    return {
      success: false,
      error: new Error("Unexpected retry failure"),
      source,
    };
  }

  private async processInBatches<T>(
    items: string[],
    processor: (item: string) => Promise<T>
  ): Promise<ProcessingResult<T>[]> {
    const results: ProcessingResult<T>[] = [];

    for (let i = 0; i < items.length; i += this.config.concurrentProcessing) {
      const batch = items.slice(i, i + this.config.concurrentProcessing);
      const batchResults = await Promise.all(
        batch.map((item) => this.retryOperation(() => processor(item), item))
      );
      results.push(...batchResults);
    }

    return results;
  }

  async processWebsites(urls: string[]): Promise<TrainingDocument[]> {
    this.log(`Starting to process ${urls.length} websites`);

    const results = await this.processInBatches(urls, (url) =>
      this.webScraper.scrapeWebsite(url)
    );

    this.logProcessingResults(results, "websites");
    return results
      .filter(
        (
          r
        ): r is ProcessingResult<TrainingDocument> & {
          data: TrainingDocument;
        } => r.success && !!r.data
      )
      .map((r) => r.data);
  }

  async processPDFs(filePaths: string[]): Promise<TrainingDocument[]> {
    this.log(`Starting to process ${filePaths.length} PDFs`);

    const results = await this.processInBatches(filePaths, (filePath) =>
      this.pdfProcessor.processPDF(filePath)
    );

    this.logProcessingResults(results, "PDFs");
    return results
      .filter(
        (
          r
        ): r is ProcessingResult<TrainingDocument> & {
          data: TrainingDocument;
        } => r.success && !!r.data
      )
      .map((r) => r.data);
  }

  private logProcessingResults(
    results: ProcessingResult<any>[],
    type: string
  ): void {
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.log(
      `Processing completed for ${type}:
      - Successful: ${successful}
      - Failed: ${failed}
      ${failed > 0 ? "\nFailed sources:" : ""}`
    );

    if (failed > 0) {
      results
        .filter((r) => !r.success)
        .forEach((r) =>
          this.log(`- ${r.source}: ${r.error?.message}`, "error")
        );
    }
  }

  async getTrainingDocuments(
    options: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      orderDirection?: "ASC" | "DESC";
      fromDate?: Date;
      toDate?: Date;
    } = {}
  ): Promise<TrainingDocument[]> {
    const {
      limit = 100,
      offset = 0,
      orderBy = "created_at",
      orderDirection = "DESC",
      fromDate,
      toDate,
    } = options;

    let query = "SELECT * FROM training_documents WHERE 1=1";
    const params: any[] = [];
    let paramIndex = 1;

    if (fromDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }

    query += ` ORDER BY ${orderBy} ${orderDirection}`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      this.log(`Database query failed: ${error}`, "error");
      throw new Error("Failed to fetch training documents");
    }
  }

  async deleteTrainingDocument(id: string): Promise<boolean> {
    try {
      const result = await pool.query(
        "DELETE FROM training_documents WHERE id = $1 RETURNING id",
        [id]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      this.log(`Failed to delete document ${id}: ${error}`, "error");
      throw new Error(`Failed to delete training document: ${error}`);
    }
  }

  async getDocumentStats(): Promise<{
    totalDocuments: number;
    averageChunksPerDocument: number;
    documentsPerType: Record<string, number>;
  }> {
    try {
      const [totalResult, avgChunksResult, typesResult] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM training_documents"),
        pool.query(
          "SELECT AVG(array_length(chunks, 1)) FROM training_documents"
        ),
        pool.query(`
          SELECT metadata->>'fileType' as type, COUNT(*) 
          FROM training_documents 
          GROUP BY metadata->>'fileType'
        `),
      ]);

      return {
        totalDocuments: parseInt(totalResult.rows[0].count),
        averageChunksPerDocument: parseFloat(avgChunksResult.rows[0].avg) || 0,
        documentsPerType: Object.fromEntries(
          typesResult.rows.map((row) => [row.type, parseInt(row.count)])
        ),
      };
    } catch (error) {
      this.log(`Failed to get document stats: ${error}`, "error");
      throw new Error("Failed to retrieve document statistics");
    }
  }
}