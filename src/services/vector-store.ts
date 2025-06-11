import { GoogleGenerativeAI } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";
import NodeCache from "node-cache";
// Import PDFChunk interface from the PDF service
// This is a forward declaration since we can't import it directly due to circular dependency
export interface PDFChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: {
    pageNumber?: number;
    section?: string;
  };
}

interface VectorEntry {
  id: string;
  chunkId: string;
  documentId: string;
  vector: number[];
  content: string;
  metadata: Record<string, any>;
}

export class VectorStoreService {
  private genAI: GoogleGenerativeAI;
  private embeddingModel: any; // Type from Google Generative AI SDK
  private vectorEntries: Map<string, VectorEntry>;
  private cache: NodeCache;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: "embedding-001",
    });
    this.vectorEntries = new Map<string, VectorEntry>();
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
  }

  /**
   * Generate embeddings for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Check cache first
      const cacheKey = `emb_${Buffer.from(text)
        .toString("base64")
        .substring(0, 32)}`;
      const cachedVector = this.cache.get<number[]>(cacheKey);

      if (cachedVector) {
        return cachedVector;
      }

      // Generate new embedding
      const result = await this.embeddingModel.embedContent(text);
      const vector = result.embedding.values;

      // Cache the result
      this.cache.set(cacheKey, vector);

      return vector;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw new Error("Failed to generate embedding");
    }
  }

  /**
   * Add a chunk to the vector store
   */
  public async addChunk(chunk: PDFChunk): Promise<string> {
    try {
      // Generate embedding for the chunk
      const vector = await this.generateEmbedding(chunk.content);

      // Create vector entry
      const entryId = uuidv4();
      const entry: VectorEntry = {
        id: entryId,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        vector,
        content: chunk.content,
        metadata: { ...chunk.metadata },
      };

      // Store in our vector entries map
      this.vectorEntries.set(entryId, entry);

      return entryId;
    } catch (error) {
      console.error("Error adding chunk to vector store:", error);
      throw new Error("Failed to add chunk to vector store");
    }
  }

  /**
   * Add multiple chunks to the vector store
   */
  public async addChunks(chunks: PDFChunk[]): Promise<string[]> {
    const entryIds: string[] = [];

    for (const chunk of chunks) {
      try {
        const entryId = await this.addChunk(chunk);
        entryIds.push(entryId);
      } catch (error) {
        console.error(`Error adding chunk ${chunk.id} to vector store:`, error);
      }
    }

    return entryIds;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error("Vectors must have the same dimensions");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Search for similar chunks
   */
  public async search(
    query: string,
    limit: number = 3,
    documentIds?: string[]
  ): Promise<{ chunk: PDFChunk; score: number }[]> {
    try {
      console.log(`Searching for: "${query}" in vector store`);

      // Generate embedding for the query
      const queryVector = await this.generateEmbedding(query);

      // Filter entries by document IDs if provided
      const entriesToSearch = documentIds
        ? Array.from(this.vectorEntries.values()).filter((entry) =>
            documentIds.includes(entry.documentId)
          )
        : Array.from(this.vectorEntries.values());

      if (entriesToSearch.length === 0) {
        console.log(
          `No entries to search in vector store (total entries: ${this.vectorEntries.size})`
        );
        return [];
      }

      console.log(`Searching through ${entriesToSearch.length} vector entries`);

      // Calculate similarity scores
      const results = entriesToSearch.map((entry) => {
        const score = this.cosineSimilarity(queryVector, entry.vector);
        return {
          chunk: {
            id: entry.chunkId,
            documentId: entry.documentId,
            content: entry.content,
            metadata: entry.metadata,
          } as PDFChunk,
          score,
        };
      });

      // Sort by score (descending) and limit results
      const sortedResults = results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // Log the top results for debugging
      console.log(`Top ${sortedResults.length} results:`);
      sortedResults.forEach((result, index) => {
        console.log(
          `  ${index + 1}. Score: ${result.score.toFixed(
            4
          )} - Content: "${result.chunk.content.substring(0, 50)}..."`
        );
      });

      return sortedResults;
    } catch (error) {
      console.error("Error searching vector store:", error);
      throw new Error("Failed to search vector store");
    }
  }

  /**
   * Delete all entries for a document
   */
  public deleteEntriesForDocument(documentId: string): number {
    let count = 0;

    for (const [entryId, entry] of this.vectorEntries.entries()) {
      if (entry.documentId === documentId) {
        this.vectorEntries.delete(entryId);
        count++;
      }
    }

    return count;
  }

  /**
   * Get the number of entries in the store
   */
  public getEntryCount(): number {
    return this.vectorEntries.size;
  }

  /**
   * Clear all vector entries
   */
  public clearAll(): void {
    this.vectorEntries.clear();
    this.cache.flushAll();
    console.log("Vector store cleared");
  }

  /**
   * Get vector store statistics
   */
  public getStats(): { entryCount: number; cacheSize: number } {
    return {
      entryCount: this.vectorEntries.size,
      cacheSize: this.cache.keys().length,
    };
  }
}
