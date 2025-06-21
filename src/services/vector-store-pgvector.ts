import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import NodeCache from "node-cache";
import crypto from "crypto";

// Import PDFChunk interface
export interface PDFChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: {
    pageNumber?: number;
    section?: string;
    type?: string;
    startIndex?: number;
  };
}

interface VectorSearchResult {
  chunk: PDFChunk;
  score: number;
}

export class VectorStorePgVectorService {
  private genAI: GoogleGenerativeAI;
  private embeddingModel: any;
  private pool: Pool;
  private cache: NodeCache;
  private readonly VECTOR_DIMENSION = 768; // Gemini embedding-001 dimension
  private readonly EMBEDDING_MODEL = "embedding-001";

  constructor(pool: Pool) {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.embeddingModel = this.genAI.getGenerativeModel({
      model: this.EMBEDDING_MODEL,
    });
    this.pool = pool;
    this.cache = new NodeCache({
      stdTTL: 3600, // 1 hour cache
      checkperiod: 600, // Check every 10 minutes
      maxKeys: 1000,
    });
  }

  /**
   * Generate embeddings for text using Gemini
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Create cache key from text hash
      const textHash = crypto
        .createHash("sha256")
        .update(text)
        .digest("hex")
        .substring(0, 32);
      const cacheKey = `emb_${textHash}`;

      // Check cache first
      const cachedVector = this.cache.get<number[]>(cacheKey);
      if (cachedVector) {
        console.log(
          `Using cached embedding for text: ${text.substring(0, 50)}...`
        );
        return cachedVector;
      }

      console.log(
        `Generating new embedding for text: ${text.substring(0, 50)}...`
      );

      // Generate new embedding
      const result = await this.embeddingModel.embedContent(text);
      const vector = result.embedding.values;

      // Validate vector dimension
      if (vector.length !== this.VECTOR_DIMENSION) {
        throw new Error(
          `Expected vector dimension ${this.VECTOR_DIMENSION}, got ${vector.length}`
        );
      }

      // Cache the result
      this.cache.set(cacheKey, vector);

      return vector;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw new Error(
        `Failed to generate embedding: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Save PDF document metadata to database
   */
  async savePDFDocument(
    documentId: string,
    originalName: string,
    fileName: string,
    filePath: string,
    fileSize: number,
    pageCount: number
  ): Promise<void> {
    try {
      // Generate content hash for duplicate detection
      const contentHash = crypto
        .createHash("sha256")
        .update(`${originalName}_${fileSize}_${pageCount}`)
        .digest("hex");

      const query = `
        INSERT INTO chatbot.pdf_documents 
        (id, original_name, file_name, file_path, file_size, page_count, content_hash, upload_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          original_name = EXCLUDED.original_name,
          file_name = EXCLUDED.file_name,
          file_path = EXCLUDED.file_path,
          file_size = EXCLUDED.file_size,
          page_count = EXCLUDED.page_count,
          content_hash = EXCLUDED.content_hash,
          upload_status = EXCLUDED.upload_status,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.pool.query(query, [
        documentId,
        originalName,
        fileName,
        filePath,
        fileSize,
        pageCount,
        contentHash,
        "completed",
      ]);

      console.log(`PDF document saved: ${originalName} (${documentId})`);
    } catch (error) {
      console.error("Error saving PDF document:", error);
      throw new Error(
        `Failed to save PDF document: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Save PDF chunk to database
   */
  async savePDFChunk(chunk: PDFChunk, chunkIndex: number): Promise<void> {
    try {
      const query = `
        INSERT INTO chatbot.pdf_chunks 
        (id, document_id, chunk_index, content, content_length, page_number, section_title, chunk_type, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          content_length = EXCLUDED.content_length,
          page_number = EXCLUDED.page_number,
          section_title = EXCLUDED.section_title,
          chunk_type = EXCLUDED.chunk_type,
          metadata = EXCLUDED.metadata
      `;

      await this.pool.query(query, [
        chunk.id,
        chunk.documentId,
        chunkIndex,
        chunk.content,
        chunk.content.length,
        chunk.metadata.pageNumber || null,
        chunk.metadata.section || null,
        chunk.metadata.type || "text",
        JSON.stringify(chunk.metadata),
      ]);

      console.log(
        `PDF chunk saved: ${chunk.id} (${chunk.content.length} chars)`
      );
    } catch (error) {
      console.error("Error saving PDF chunk:", error);
      throw new Error(
        `Failed to save PDF chunk: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Add a chunk to the vector store with pgvector
   */
  public async addChunk(
    chunk: PDFChunk,
    chunkIndex: number = 0
  ): Promise<string> {
    try {
      console.log(`Adding chunk to vector store: ${chunk.id}`);

      // Save chunk to database first
      await this.savePDFChunk(chunk, chunkIndex);

      // Generate embedding for the chunk
      const vector = await this.generateEmbedding(chunk.content);

      // Save vector embedding to database
      const vectorId = uuidv4();
      const query = `
        INSERT INTO chatbot.vector_embeddings 
        (id, chunk_id, document_id, embedding_model, embedding_vector, vector_dimension)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (chunk_id) DO UPDATE SET
          embedding_vector = EXCLUDED.embedding_vector,
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension
        RETURNING id
      `;

      const result = await this.pool.query(query, [
        vectorId,
        chunk.id,
        chunk.documentId,
        this.EMBEDDING_MODEL,
        JSON.stringify(vector), // pgvector will handle the conversion
        this.VECTOR_DIMENSION,
      ]);

      const savedVectorId = result.rows[0]?.id || vectorId;
      console.log(
        `Vector embedding saved: ${savedVectorId} for chunk ${chunk.id}`
      );

      return savedVectorId;
    } catch (error) {
      console.error("Error adding chunk to vector store:", error);
      throw new Error(
        `Failed to add chunk to vector store: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Add multiple chunks in batch for better performance
   */
  public async addChunks(chunks: PDFChunk[]): Promise<string[]> {
    const vectorIds: string[] = [];

    console.log(`Adding ${chunks.length} chunks to vector store in batch`);

    // Process chunks in batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      const batchPromises = batch.map((chunk, index) =>
        this.addChunk(chunk, i + index)
      );

      try {
        const batchResults = await Promise.all(batchPromises);
        vectorIds.push(...batchResults);

        // Small delay between batches to respect API rate limits
        if (i + batchSize < chunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error processing batch ${i}-${i + batchSize}:`, error);
        // Continue with next batch instead of failing completely
      }
    }

    console.log(
      `Successfully added ${vectorIds.length}/${chunks.length} chunks to vector store`
    );
    return vectorIds;
  }

  /**
   * Search for similar chunks using pgvector
   */
  public async search(
    query: string,
    limit: number = 3,
    documentIds?: string[],
    similarityThreshold: number = 0.2
  ): Promise<VectorSearchResult[]> {
    try {
      console.log(
        `Searching for: "${query}" with threshold ${similarityThreshold}`
      );

      // Generate embedding for the query
      const queryVector = await this.generateEmbedding(query);

      // Build the SQL query
      let sqlQuery = `
        SELECT 
          c.id,
          c.document_id,
          c.content,
          c.metadata,
          1 - (v.embedding_vector <=> $1::vector) as similarity_score
        FROM chatbot.vector_embeddings v
        JOIN chatbot.pdf_chunks c ON v.chunk_id = c.id
        WHERE 1 - (v.embedding_vector <=> $1::vector) >= $2
      `;

      const queryParams: any[] = [
        JSON.stringify(queryVector),
        similarityThreshold,
      ];

      // Add document filter if provided
      if (documentIds && documentIds.length > 0) {
        sqlQuery += ` AND c.document_id = ANY($3)`;
        queryParams.push(documentIds);
      }

      sqlQuery += `
        ORDER BY v.embedding_vector <=> $1::vector
        LIMIT $${queryParams.length + 1}
      `;
      queryParams.push(limit);

      // Execute the query
      const result = await this.pool.query(sqlQuery, queryParams);

      // Transform results
      const searchResults: VectorSearchResult[] = result.rows.map((row) => ({
        chunk: {
          id: row.id,
          documentId: row.document_id,
          content: row.content,
          metadata: row.metadata || {},
        },
        score: parseFloat(row.similarity_score),
      }));

      console.log(
        `Found ${searchResults.length} results with similarity >= ${similarityThreshold}`
      );
      searchResults.forEach((result, index) => {
        console.log(
          `  ${index + 1}. Score: ${result.score.toFixed(
            4
          )} - Content: "${result.chunk.content.substring(0, 50)}..."`
        );
      });

      return searchResults;
    } catch (error) {
      console.error("Error searching vector store:", error);
      throw new Error(
        `Failed to search vector store: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete all entries for a document
   */
  public async deleteEntriesForDocument(documentId: string): Promise<number> {
    try {
      const query = `
        DELETE FROM chatbot.vector_embeddings
        WHERE document_id = $1
      `;

      const result = await this.pool.query(query, [documentId]);
      const deletedCount = result.rowCount || 0;

      console.log(
        `Deleted ${deletedCount} vector entries for document ${documentId}`
      );
      return deletedCount;
    } catch (error) {
      console.error("Error deleting vector entries:", error);
      throw new Error(
        `Failed to delete vector entries: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get the number of entries in the store
   */
  public async getEntryCount(): Promise<number> {
    try {
      const result = await this.pool.query(
        "SELECT COUNT(*) as count FROM chatbot.vector_embeddings"
      );
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error("Error getting entry count:", error);
      return 0;
    }
  }

  /**
   * Clear all vector entries
   */
  public async clearAll(): Promise<void> {
    try {
      await this.pool.query("DELETE FROM chatbot.vector_embeddings");
      await this.pool.query("DELETE FROM chatbot.pdf_chunks");
      await this.pool.query("DELETE FROM chatbot.pdf_documents");
      this.cache.flushAll();
      console.log("Vector store cleared");
    } catch (error) {
      console.error("Error clearing vector store:", error);
      throw new Error(
        `Failed to clear vector store: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get vector store statistics
   */
  public async getStats(): Promise<{
    entryCount: number;
    documentCount: number;
    chunkCount: number;
    cacheSize: number;
  }> {
    try {
      const [vectorResult, documentResult, chunkResult] = await Promise.all([
        this.pool.query(
          "SELECT COUNT(*) as count FROM chatbot.vector_embeddings"
        ),
        this.pool.query("SELECT COUNT(*) as count FROM chatbot.pdf_documents"),
        this.pool.query("SELECT COUNT(*) as count FROM chatbot.pdf_chunks"),
      ]);

      return {
        entryCount: parseInt(vectorResult.rows[0].count),
        documentCount: parseInt(documentResult.rows[0].count),
        chunkCount: parseInt(chunkResult.rows[0].count),
        cacheSize: this.cache.keys().length,
      };
    } catch (error) {
      console.error("Error getting stats:", error);
      return {
        entryCount: 0,
        documentCount: 0,
        chunkCount: 0,
        cacheSize: 0,
      };
    }
  }

  /**
   * Check if document exists in database
   */
  public async documentExists(documentId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "SELECT id FROM chatbot.pdf_documents WHERE id = $1",
        [documentId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error("Error checking document existence:", error);
      return false;
    }
  }

  /**
   * Get document chunks from database
   */
  public async getDocumentChunks(documentId: string): Promise<PDFChunk[]> {
    try {
      const query = `
        SELECT id, document_id, content, metadata
        FROM chatbot.pdf_chunks
        WHERE document_id = $1
        ORDER BY chunk_index
      `;

      const result = await this.pool.query(query, [documentId]);

      return result.rows.map((row) => ({
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        metadata: row.metadata || {},
      }));
    } catch (error) {
      console.error("Error getting document chunks:", error);
      return [];
    }
  }

  /**
   * Get all documents from database
   */
  public async getAllDocuments(): Promise<
    Array<{
      id: string;
      originalName: string;
      fileName: string;
      filePath: string;
      fileSize: number;
      pageCount: number;
      createdAt: Date;
    }>
  > {
    try {
      const query = `
        SELECT id, original_name, file_name, file_path, file_size, page_count, created_at
        FROM chatbot.pdf_documents
        WHERE upload_status = 'completed'
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query);

      return result.rows.map((row) => ({
        id: row.id,
        originalName: row.original_name,
        fileName: row.file_name,
        filePath: row.file_path,
        fileSize: row.file_size,
        pageCount: row.page_count,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error("Error getting all documents:", error);
      return [];
    }
  }
}
