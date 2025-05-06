import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { GeminiService } from "./gemini";
import NodeCache from "node-cache";
import { Message } from "../types";

export class ChatService {
  private pool: Pool;
  private geminiService: GeminiService;
  private messageCache: NodeCache;
  private readonly CACHE_TTL = 3600;
  private readonly MAX_MESSAGE_LENGTH = 4096;
  private readonly MAX_HISTORY_MESSAGES = 50;

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
    this.initializeTables();

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

  private async initializeTables() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`
        CREATE SCHEMA IF NOT EXISTS chatbot;

CREATE TABLE IF NOT EXISTS chatbot.chats (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  terms_accepted BOOLEAN DEFAULT FALSE
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

  // New method to remove markdown formatting
  private removeMarkdownFormatting(content: string): string {
    // Remove bold formatting (double asterisks)
    let cleanedContent = content.replace(/\*\*(.*?)\*\*/g, "$1");

    // Remove italic formatting (single asterisks)
    cleanedContent = cleanedContent.replace(/\*(.*?)\*/g, "$1");

    // Remove heading formatting (# symbols)
    cleanedContent = cleanedContent.replace(/^#+\s+(.*)$/gm, "$1");

    // Remove bullet points formatting
    cleanedContent = cleanedContent.replace(/^\s*\*\s+(.*)$/gm, "- $1");

    return cleanedContent;
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

  async processUserMessage(
    chatId: string,
    content: string
  ): Promise<Message[]> {
    const validChatId = await this.ensureValidChatId(chatId);
    const history = await this.getChatHistory(validChatId);

    const formattedHistory = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const userMessage = await this.saveMessage(validChatId, {
      content: this.truncateMessage(content),
      timestamp: new Date(),
      role: "user",
      chatId: validChatId,
    });

    try {
      const aiResponse = await Promise.race([
        this.geminiService.generateResponse(content, {
          history: formattedHistory,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("AI response timeout")), 30000)
        ),
      ]);

      // Clean the AI response by removing markdown formatting before saving
      const cleanedResponse = this.removeMarkdownFormatting(aiResponse);

      const assistantMessage = await this.saveMessage(validChatId, {
        content: this.truncateMessage(cleanedResponse),
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      return [userMessage, assistantMessage];
    } catch (error) {
      console.error("Error processing message:", error);
      throw error;
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
      "INSERT INTO chatbot.chats (id, created_at, updated_at, terms_accepted) VALUES ($1, NOW(), NOW(), FALSE)",
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

  async acceptTermsAndConditions(chatId: string): Promise<Message> {
    const validChatId = await this.ensureValidChatId(chatId);

    // Update the chat to mark terms as accepted
    await this.pool.query(
      "UPDATE chatbot.chats SET terms_accepted = TRUE, updated_at = NOW() WHERE id = $1",
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
      const fallbackMessage =
        "Terima kasih telah menyetujui persyaratan kami. Ada yang bisa saya bantu?";

      const welcomeMessage = await this.saveMessage(validChatId, {
        content: fallbackMessage,
        timestamp: new Date(),
        role: "assistant",
        chatId: validChatId,
      });

      return welcomeMessage;
    }
  }

  async isChatTermsAccepted(chatId: string): Promise<boolean> {
    if (!this.isValidUUID(chatId)) return false;

    const result = await this.pool.query(
      "SELECT terms_accepted FROM chatbot.chats WHERE id = $1",
      [chatId]
    );

    return result.rows.length > 0 ? result.rows[0].terms_accepted : false;
  }

  async cleanup() {
    await this.pool.end();
    this.messageCache.close();
  }
}
