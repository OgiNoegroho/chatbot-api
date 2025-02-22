// src/services/webscraper.ts
import axios from "axios";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import type { TrainingDocument } from "../types/training";
import { pool } from "../config/database";

interface WebScraperConfig {
  enableLogging?: boolean;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class WebScraperService {
  private readonly config: Required<WebScraperConfig>;

  constructor(config?: WebScraperConfig) {
    this.config = {
      enableLogging: config?.enableLogging ?? true,
      timeout: config?.timeout ?? 10000,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 1000,
    };
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

  async scrapeWebsite(url: string): Promise<TrainingDocument> {
    let attempts = 0;

    while (attempts < this.config.maxRetries) {
      try {
        const response = await axios.get(url, {
          timeout: this.config.timeout,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TrainingBot/1.0;)",
          },
        });

        const $ = cheerio.load(response.data);

        // Remove unwanted elements
        $(
          "script, style, nav, footer, header, .ads, #ads, .navigation"
        ).remove();

        const title = $("title").text().trim();
        const content = $("body").text().replace(/\s+/g, " ").trim();

        if (!content) {
          throw new Error("No content extracted from webpage");
        }

        const document: TrainingDocument = {
          id: uuidv4(),
          source: url,
          content,
          metadata: {
            title,
            url,
            fileType: "web",
            date: new Date(),
          },
          chunks: await this.chunkContent(content),
          created_at: new Date(),
        };

        await this.saveDocument(document);
        return document;
      } catch (error) {
        attempts++;
        if (attempts === this.config.maxRetries) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to scrape website: ${url} - ${message}`);
        }
        this.log(`Attempt ${attempts} failed, retrying...`, "warn");
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelay)
        );
      }
    }

    throw new Error(
      `Failed to scrape website after ${this.config.maxRetries} attempts`
    );
  }

  private async chunkContent(content: string): Promise<string[]> {
    const chunks: string[] = [];
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    let currentChunk = "";

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= 1000) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length >= 100) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk.length >= 100) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
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
}
