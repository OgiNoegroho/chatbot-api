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
    this.pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || "5432"),
      max: parseInt(process.env.DB_POOL_SIZE || "20"),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
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
  }

  private async reconnectDatabase() {
    try {
      await this.pool.end();
      this.pool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || "5432"),
      });
    } catch (error) {
      console.error("Failed to reconnect to database:", error);
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

      await client.query(`
        CREATE SCHEMA IF NOT EXISTS chatbot;

CREATE TABLE IF NOT EXISTS chatbot.chats (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chatbot.messages (
  id UUID PRIMARY KEY,
  chat_id UUID REFERENCES chatbot.chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chatbot.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chatbot.messages(timestamp);`);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
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
      // Upload the PDF using the PDF service
      const documentId = await this.pdfService.uploadPDF(
        tempFilePath,
        originalName
      );

      // Get the chunks from the PDF
      const chunks = this.pdfService.getDocumentChunks(documentId);

      // Add the chunks to the vector store
      await this.vectorStore.addChunks(chunks);

      console.log(
        `PDF ${originalName} uploaded with ID ${documentId} and ${chunks.length} chunks indexed`
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
   * Delete a PDF document
   */
  deletePDFDocument(documentId: string): boolean {
    // Delete from vector store first
    this.vectorStore.deleteEntriesForDocument(documentId);

    // Then delete from PDF service
    return this.pdfService.deleteDocument(documentId);
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
      searchResults.forEach((result, index) => {
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
        (result) => result.score >= SIMILARITY_THRESHOLD
      );

      if (relevantResults.length === 0) {
        console.log(`No relevant PDF content found for query: "${query}"`);

        // Always try fallback to text search when vector search doesn't find enough results
        console.log("Attempting fallback to text search...");
        const textSearchResults = this.pdfService.searchInDocuments(query);

        if (textSearchResults.chunks.length > 0) {
          console.log(
            `Text search found ${textSearchResults.chunks.length} relevant chunks`
          );

          // Get document names for attribution
          const documentNames: Record<string, string> = {};
          for (const docId of textSearchResults.documentIds) {
            const doc = this.pdfService.getDocument(docId);
            if (doc) {
              documentNames[docId] = doc.name;
            }
          }

          // Limit to MAX_PDF_CHUNKS
          const limitedChunks = textSearchResults.chunks.slice(
            0,
            this.MAX_PDF_CHUNKS
          );

          return {
            chunks: limitedChunks.map((chunk) => ({
              content: chunk.content,
              documentId: chunk.documentId,
            })),
            documentNames,
          };
        }

        return null;
      }

      console.log(
        `Found ${relevantResults.length} relevant chunks above threshold for query: "${query}"`
      );

      // Get document names for attribution
      const documentIds = [
        ...new Set(relevantResults.map((result) => result.chunk.documentId)),
      ];
      const documentNames: Record<string, string> = {};

      for (const docId of documentIds) {
        const doc = this.pdfService.getDocument(docId);
        if (doc) {
          documentNames[docId] = doc.name;
        }
      }

      // Sort by relevance score (highest first)
      relevantResults.sort((a, b) => b.score - a.score);

      // Log the selected chunks
      console.log("Selected PDF chunks for context:");
      relevantResults.forEach((result, index) => {
        console.log(
          `  Chunk ${index + 1}: Score: ${result.score.toFixed(4)}, Document: ${
            documentNames[result.chunk.documentId] || "Unknown"
          }`
        );
      });

      return {
        chunks: relevantResults.map((result) => ({
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
