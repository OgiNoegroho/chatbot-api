// src/services/webscraper.ts
import axios from "axios";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/database";
import type { TrainingDocument } from "../types/training";

export class WebScraperService {
  private readonly maxChunkSize = 1000; // characters per chunk

  async scrapeWebsite(url: string): Promise<TrainingDocument> {
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $("script, style, nav, footer, header, aside").remove();

      // Extract main content
      const title = $("title").text().trim();
      const mainContent = $("main, article, .content, #content, .post")
        .text()
        .replace(/\s+/g, " ")
        .trim();

      // Fallback to body if no main content found
      const content =
        mainContent || $("body").text().replace(/\s+/g, " ").trim();

      const document: TrainingDocument = {
        id: uuidv4(),
        source: url,
        content,
        metadata: {
          title,
          url,
          date: new Date(),
          fileType: "web",
        },
        chunks: this.chunkContent(content),
        created_at: new Date(),
      };

      await this.saveDocument(document);
      return document;
    } catch (error) {
      console.error("Web scraping error:", error);
      throw new Error(`Failed to scrape website: ${url}`);
    }
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
