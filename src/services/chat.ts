import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { GeminiService } from "./gemini";
import { PDFService } from "./pdf";
import { VectorStoreService } from "./vector-store";
import NodeCache from "node-cache";
import { Message } from "../types";

export class ChatService {
  private pool: Pool;
  private geminiService: GeminiService;
  private pdfService: PDFService;
  private vectorStore: VectorStoreService;
  private messageCache: NodeCache;
  private readonly CACHE_TTL = 3600;
  private readonly MAX_MESSAGE_LENGTH = 4096;
  private readonly MAX_HISTORY_MESSAGES = 10; // Reduced from 50 to improve performance
  private readonly MAX_PDF_CHUNKS = 2; // Reduced from 3 to improve performance

  constructor() {
    // Configure connection for Supabase PostgreSQL
    this.pool = new Pool({
      user: process.env.SUPABASE_DB_USER || process.env.DB_USER,
      host: process.env.SUPABASE_DB_HOST || process.env.DB_HOST,
      database: process.env.SUPABASE_DB_NAME || process.env.DB_NAME,
      password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
      port: parseInt(
        process.env.SUPABASE_DB_PORT || process.env.DB_PORT || "5432"
      ),
      max: parseInt(process.env.DB_POOL_SIZE || "20"),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: {
        rejectUnauthorized: false, // Required for Supabase SSL connections
      },
    });

    this.messageCache = new NodeCache({
      stdTTL: this.CACHE_TTL,
      checkperiod: 120,
      maxKeys: 1000,
      useClones: false,
    });

    this.geminiService = new GeminiService();
    this.pdfService = new PDFService();
    this.vectorStore = new VectorStoreService();
    this.initializeTables();

    // Index existing PDFs into vector store after services are initialized
    // Use setTimeout to ensure this runs after constructor completes
    setTimeout(() => {
      this.indexExistingPDFs().catch((error) => {
        console.error("Error during PDF indexing:", error);
      });
    }, 1000);

    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
      this.reconnectDatabase();
    });

    // Test Supabase connection on startup
    this.testSupabaseConnection();
  }

  /**
   * Test Supabase database connection
   */
  private async testSupabaseConnection(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query("SELECT NOW()");
      client.release();
      console.log("✅ Supabase database connection successful");
    } catch (error) {
      console.error("❌ Supabase database connection failed:", error);
    }
  }

  private async reconnectDatabase() {
    try {
      await this.pool.end();
      this.pool = new Pool({
        user: process.env.SUPABASE_DB_USER || process.env.DB_USER,
        host: process.env.SUPABASE_DB_HOST || process.env.DB_HOST,
        database: process.env.SUPABASE_DB_NAME || process.env.DB_NAME,
        password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
        port: parseInt(
          process.env.SUPABASE_DB_PORT || process.env.DB_PORT || "5432"
        ),
        ssl: {
          rejectUnauthorized: false, // Required for Supabase SSL connections
        },
      });
      console.log("✅ Reconnected to Supabase database successfully");
    } catch (error) {
      console.error("❌ Failed to reconnect to Supabase database:", error);
    }
  }

  /**
   * Index existing PDFs into the vector store
   */
  private async indexExistingPDFs(): Promise<void> {
    try {
      console.log("Indexing existing PDFs into vector store...");
      const documents = this.pdfService.getAllDocuments();

      if (documents.length === 0) {
        console.log("No existing PDFs to index");
        return;
      }

      let totalChunksIndexed = 0;
      for (const document of documents) {
        try {
          const chunks = this.pdfService.getDocumentChunks(document.id);
          await this.vectorStore.addChunks(chunks);
          totalChunksIndexed += chunks.length;
          console.log(
            `Indexed ${chunks.length} chunks for document: ${document.name}`
          );
        } catch (error) {
          console.error(`Error indexing document ${document.name}:`, error);
        }
      }

      console.log(
        `Successfully indexed ${totalChunksIndexed} chunks from ${documents.length} documents`
      );
    } catch (error) {
      console.error("Error indexing existing PDFs:", error);
    }
  }

  private async initializeTables() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      console.log("🔧 Initializing Supabase database tables...");

      // Create schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS chatbot;`);

      // Enable pgvector extension for Supabase (if available)
      try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        console.log("✅ pgvector extension enabled");
      } catch (error) {
        console.log(
          "⚠️ pgvector extension not available, continuing without vector support"
        );
      }

      // Create chats table
      await client.query(`
        CREATE TABLE IF NOT EXISTS chatbot.chats (
          id UUID PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create messages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS chatbot.messages (
          id UUID PRIMARY KEY,
          chat_id UUID REFERENCES chatbot.chats(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create PDF documents table
      await client.query(`
        CREATE TABLE IF NOT EXISTS chatbot.pdf_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          original_name VARCHAR(255) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_path TEXT NOT NULL,
          file_size BIGINT NOT NULL,
          page_count INTEGER,
          content_hash VARCHAR(64),
          upload_status VARCHAR(20) DEFAULT 'completed' CHECK (upload_status IN ('processing', 'completed', 'failed')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create PDF chunks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS chatbot.pdf_chunks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          content_length INTEGER NOT NULL,
          page_number INTEGER,
          section_title VARCHAR(255),
          chunk_type VARCHAR(50) DEFAULT 'text',
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query("COMMIT");

      // Create vector embeddings table with pgvector (in separate transaction)
      await client.query("BEGIN");
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
            document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
            embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
            embedding_vector vector(768),
            vector_dimension INTEGER NOT NULL DEFAULT 768,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log("✅ Vector embeddings table created with pgvector support");
        await client.query("COMMIT");
      } catch (vectorError) {
        await client.query("ROLLBACK");
        console.log(
          "⚠️ Creating vector embeddings table without vector type (pgvector not available)"
        );
        await client.query("BEGIN");
        await client.query(`
          CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
            document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
            embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
            embedding_vector TEXT,
            vector_dimension INTEGER NOT NULL DEFAULT 768,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await client.query("COMMIT");
      }

      // Create indexes in separate transaction
      await client.query("BEGIN");
      try {
        // Create basic indexes
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chatbot.messages(chat_id);
          CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chatbot.messages(timestamp);
          CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document_id ON chatbot.pdf_chunks(document_id);
          CREATE INDEX IF NOT EXISTS idx_vector_embeddings_chunk_id ON chatbot.vector_embeddings(chunk_id);
          CREATE INDEX IF NOT EXISTS idx_vector_embeddings_document_id ON chatbot.vector_embeddings(document_id);
        `);

        // Create vector similarity index using HNSW (conditional)
        try {
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw
            ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops);
          `);
          console.log("✅ Vector similarity index created");
        } catch (indexError) {
          console.log(
            "⚠️ Vector similarity index not created (pgvector not available)"
          );
        }

        await client.query("COMMIT");
        console.log("✅ Supabase database tables initialized successfully");
      } catch (indexError) {
        await client.query("ROLLBACK");
        console.error("❌ Error creating indexes:", indexError);
        // Continue without indexes
        console.log("⚠️ Continuing without some indexes");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("❌ Error initializing Supabase database tables:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  public isValidUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str
    );
  }

  private truncateMessage(content: string): string {
    return content.length > this.MAX_MESSAGE_LENGTH
      ? content.substring(0, this.MAX_MESSAGE_LENGTH)
      : content;
  }

  // Simplified markdown formatting removal for better performance
  private removeMarkdownFormatting(content: string): string {
    // Simple one-pass replacement for common markdown elements
    return content
      .replace(/\*\*|__/g, "") // Remove bold markers
      .replace(/\*|_/g, "") // Remove italic markers
      .replace(/^#+\s+/gm, "") // Remove heading markers
      .replace(/`/g, ""); // Remove code markers
  }

  async getChatHistory(chatId: string): Promise<Message[]> {
    if (!this.isValidUUID(chatId)) return [];

    const cachedHistory = this.messageCache.get<Message[]>(chatId);
    if (cachedHistory) return cachedHistory;

    const result = await this.pool.query(
      "SELECT * FROM chatbot.messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT $2",
      [chatId, this.MAX_HISTORY_MESSAGES]
    );

    const messages = result.rows.reverse();
    this.messageCache.set(chatId, messages);
    return messages;
  }

  async saveMessage(
    chatId: string,
    message: Omit<Message, "id" | "userId">
  ): Promise<Message> {
    const messageId = uuidv4();
    const truncatedContent = this.truncateMessage(message.content);

    const result = await this.pool.query(
      "INSERT INTO chatbot.messages (id, chat_id, content, role, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [messageId, chatId, truncatedContent, message.role, message.timestamp]
    );

    this.messageCache.del(chatId);
    return result.rows[0];
  }

  /**
   * Upload a PDF document and process it for vector search
   */
  async uploadPDF(tempFilePath: string, originalName: string): Promise<string> {
    try {
      // Upload the PDF using the PDF service (this will save to database and generate vectors)
      const documentId = await this.pdfService.uploadPDF(
        tempFilePath,
        originalName
      );

      console.log(
        `PDF ${originalName} uploaded with ID ${documentId} and saved to Supabase database`
      );

      return documentId;
    } catch (error) {
      console.error("Error uploading PDF:", error);
      throw new Error("Failed to upload and process PDF");
    }
  }

  /**
   * Get all available PDF documents
   */
  getAllPDFDocuments() {
    return this.pdfService.getAllDocuments();
  }

  /**
   * Get document names by IDs
   */
  private async getDocumentNames(
    documentIds: string[]
  ): Promise<Record<string, string>> {
    try {
      const allDocuments = this.pdfService.getAllDocuments();
      const documentNames: Record<string, string> = {};

      for (const docId of documentIds) {
        const doc = allDocuments.find((d: any) => d.id === docId);
        if (doc) {
          documentNames[docId] = doc.name;
        }
      }

      return documentNames;
    } catch (error) {
      console.error("Error getting document names:", error);
      return {};
    }
  }

  /**
   * Delete a PDF document
   */
  async deletePDFDocument(documentId: string): Promise<boolean> {
    try {
      // Delete from vector store first
      this.vectorStore.deleteEntriesForDocument(documentId);

      // Then delete from PDF service
      return this.pdfService.deleteDocument(documentId);
    } catch (error) {
      console.error("Error deleting PDF document:", error);
      return false;
    }
  }

  /**
   * Find relevant PDF content for a query
   */
  public async findRelevantPDFContent(query: string): Promise<{
    chunks: Array<{ content: string; documentId: string }>;
    documentNames: Record<string, string>;
  } | null> {
    try {
      console.log(`Finding relevant PDF content for query: "${query}"`);

      // Define a minimum similarity threshold (0.0 to 1.0)
      // Further lowered threshold to be more inclusive for Indonesian language queries
      const SIMILARITY_THRESHOLD = 0.2;

      // Search for relevant chunks using vector search
      const searchResults = await this.vectorStore.search(
        query,
        this.MAX_PDF_CHUNKS
      );

      // Log all search results for debugging
      console.log(`Vector search returned ${searchResults.length} results`);
      searchResults.forEach((result: any, index: number) => {
        console.log(
          `  Result ${index + 1}: Score: ${result.score.toFixed(
            4
          )}, DocumentId: ${
            result.chunk.documentId
          }, Content: "${result.chunk.content.substring(0, 50)}..."`
        );
      });

      // Filter results by similarity threshold
      const relevantResults = searchResults.filter(
        (result: any) => result.score >= SIMILARITY_THRESHOLD
      );

      if (relevantResults.length === 0) {
        console.log(`No relevant PDF content found for query: "${query}"`);
        return null;
      }

      console.log(
        `Found ${relevantResults.length} relevant chunks above threshold for query: "${query}"`
      );

      // Get document names for attribution
      const documentIds: string[] = [
        ...new Set(
          relevantResults.map(
            (result: any) => result.chunk.documentId as string
          )
        ),
      ];
      const documentNames = await this.getDocumentNames(documentIds);

      // Sort by relevance score (highest first)
      relevantResults.sort((a: any, b: any) => b.score - a.score);

      // Log the selected chunks
      console.log("Selected PDF chunks for context:");
      relevantResults.forEach((result: any, index: number) => {
        console.log(
          `  Chunk ${index + 1}: Score: ${result.score.toFixed(4)}, Document: ${
            documentNames[result.chunk.documentId] || "Unknown"
          }`
        );
      });

      return {
        chunks: relevantResults.map((result: any) => ({
          content: result.chunk.content,
          documentId: result.chunk.documentId,
        })),
        documentNames,
      };
    } catch (error) {
      console.error("Error finding relevant PDF content:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message);
        console.error("Error stack:", error.stack);
      }
      return null;
    }
  }

  async processUserMessage(
    chatId: string,
    content: string
  ): Promise<Message[]> {
    console.log(
      `Processing user message for chat ${chatId}: "${content.substring(
        0,
        100
      )}${content.length > 100 ? "..." : ""}"`
    );

    const validChatId = await this.ensureValidChatId(chatId);
    const history = await this.getChatHistory(validChatId);

    const formattedHistory = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    console.log(`Chat history contains ${formattedHistory.length} messages`);

    const userMessage = await this.saveMessage(validChatId, {
      content: this.truncateMessage(content),
      timestamp: new Date(),
      role: "user",
      chatId: validChatId,
    });

    try {
      console.log(`Finding relevant PDF content for user query...`);
      // Find relevant PDF content for the query
      const pdfContext = await this.findRelevantPDFContent(content);

      if (pdfContext) {
        console.log(
          `Found PDF context with ${pdfContext.chunks.length} chunks from ${
            Object.keys(pdfContext.documentNames).length
          } documents`
        );
        // Log document names
        Object.entries(pdfContext.documentNames).forEach(([docId, name]) => {
          console.log(`  Document: ${name} (${docId})`);
        });
      } else {
        console.log(`No relevant PDF context found for this query`);
      }

      console.log(`Generating AI response...`);
      // Generate AI response with or without PDF context
      // Reduced timeout from 30s to 15s to fail faster if there's an issue
      const aiResponse = await Promise.race([
        this.geminiService.generateResponse(content, {
          history: formattedHistory,
          pdfContext: pdfContext || undefined,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("AI response timeout")), 15000)
        ),
      ]);

      console.log(`AI response generated (${aiResponse.length} characters)`);

      // Clean the AI response by removing markdown formatting before saving
      const cleanedResponse = this.removeMarkdownFormatting(aiResponse);

      const assistantMessage = await this.saveMessage(validChatId, {
        content: this.truncateMessage(cleanedResponse),
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      console.log(`Response saved to database`);
      return [userMessage, assistantMessage];
    } catch (error) {
      console.error("Error processing message:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message);
        console.error("Error stack:", error.stack);
      }

      // Save a fallback error message
      const errorMessage = await this.saveMessage(validChatId, {
        content:
          "Maaf, saya mengalami kesulitan dalam memproses pesan Anda. Silakan coba lagi nanti.",
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      return [userMessage, errorMessage];
    }
  }

  private async ensureValidChatId(chatId: string): Promise<string> {
    // First check if it's a valid UUID
    if (this.isValidUUID(chatId)) {
      // Query the database to see if this chat exists
      const chatExists = await this.pool.query(
        "SELECT id FROM chatbot.chats WHERE id = $1",
        [chatId]
      );

      if (chatExists.rows.length > 0) {
        // Chat exists, return the ID
        return chatId;
      }

      // If it's a valid UUID but doesn't exist in DB yet, create it with this ID
      await this.pool.query(
        "INSERT INTO chatbot.chats (id, created_at, updated_at) VALUES ($1, NOW(), NOW())",
        [chatId]
      );
      return chatId;
    }

    // If not a valid UUID, create a new chat
    return await this.createChat();
  }

  async createChat(): Promise<string> {
    const chatId = uuidv4();
    await this.pool.query(
      "INSERT INTO chatbot.chats (id, created_at, updated_at) VALUES ($1, NOW(), NOW())",
      [chatId]
    );
    return chatId;
  }

  async createChatWithId(chatId: string): Promise<string> {
    if (!this.isValidUUID(chatId)) {
      throw new Error("Invalid UUID provided for chat ID");
    }

    // Check if chat already exists
    const chatExists = await this.chatExists(chatId);
    if (chatExists) {
      throw new Error(`Chat with ID ${chatId} already exists`);
    }

    // Create chat with the provided ID
    await this.pool.query(
      "INSERT INTO chatbot.chats (id, created_at, updated_at) VALUES ($1, NOW(), NOW())",
      [chatId]
    );
    return chatId;
  }

  async chatExists(chatId: string): Promise<boolean> {
    if (!this.isValidUUID(chatId)) return false;

    const result = await this.pool.query(
      "SELECT id FROM chatbot.chats WHERE id = $1",
      [chatId]
    );

    return result.rows.length > 0;
  }

  async sendWelcomeMessage(chatId: string): Promise<Message> {
    const validChatId = await this.ensureValidChatId(chatId);

    // Update the chat's updated_at timestamp
    await this.pool.query(
      "UPDATE chatbot.chats SET updated_at = NOW() WHERE id = $1",
      [validChatId]
    );

    try {
      // Get welcome message from Gemini
      const welcomeContent = await this.geminiService.generateWelcomeMessage();

      // Clean the welcome message by removing markdown formatting
      const cleanedWelcomeContent =
        this.removeMarkdownFormatting(welcomeContent);

      // Send welcome message from assistant
      const welcomeMessage = await this.saveMessage(validChatId, {
        content: this.truncateMessage(cleanedWelcomeContent),
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      return welcomeMessage;
    } catch (error) {
      console.error("Error generating welcome message:", error);
      // Fallback to a default message if Gemini fails
      const fallbackMessage = "Halo! Ada yang bisa saya bantu?";

      const welcomeMessage = await this.saveMessage(validChatId, {
        content: fallbackMessage,
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      return welcomeMessage;
    }
  }

  async cleanup() {
    await this.pool.end();
    this.messageCache.close();
  }
}
