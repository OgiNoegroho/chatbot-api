// src/services/chat.ts
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { OllamaService } from "./ollama";
import { Message } from "../types";
import NodeCache from "node-cache";

export class ChatService {
  private pool: Pool;
  private ollamaService: OllamaService;
  private messageCache: NodeCache;
  private readonly CACHE_TTL = 3600; // 1 hour in seconds
  private readonly MAX_MESSAGE_LENGTH = 2000;
  private readonly MAX_HISTORY_MESSAGES = 50;

  constructor() {
    // Initialize PostgreSQL pool with optimized settings
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

    // Initialize cache with optimized settings
    this.messageCache = new NodeCache({
      stdTTL: this.CACHE_TTL,
      checkperiod: 120,
      maxKeys: 1000,
      useClones: false,
    });

    this.ollamaService = new OllamaService();

    // Handle pool errors
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }

  private isValidUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str
    );
  }

  private truncateMessage(content: string): string {
    return content.length > this.MAX_MESSAGE_LENGTH
      ? content.substring(0, this.MAX_MESSAGE_LENGTH)
      : content;
  }

  async getChatHistory(chatId: string): Promise<Message[]> {
    if (!this.isValidUUID(chatId)) return [];

    // Try to get from cache first
    const cachedHistory = this.messageCache.get<Message[]>(chatId);
    if (cachedHistory) return cachedHistory;

    // If not in cache, get from database with pagination
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
    message: Omit<Message, "id">
  ): Promise<Message> {
    const messageId = uuidv4();
    const truncatedContent = this.truncateMessage(message.content);

    const result = await this.pool.query(
      "INSERT INTO chatbot.messages (id, chat_id, user_id, content, role, timestamp) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [
        messageId,
        chatId,
        message.userId,
        truncatedContent,
        message.role,
        message.timestamp,
      ]
    );

    // Invalidate cache for this chat
    this.messageCache.del(chatId);

    return result.rows[0];
  }

  async processUserMessage(
    chatId: string,
    userId: string,
    content: string
  ): Promise<Message[]> {
    const validChatId = await this.ensureValidChatId(chatId, userId);

    // Save user message
    const userMessage = await this.saveMessage(validChatId, {
      userId,
      content: this.truncateMessage(content),
      timestamp: new Date(),
      role: "user",
    });

    try {
      // Generate AI response with timeout
      const aiResponse = await Promise.race([
        this.ollamaService.generateResponse(content),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("AI response timeout")), 15000)
        ),
      ]);

      const assistantMessage = await this.saveMessage(validChatId, {
        userId,
        content: this.truncateMessage(aiResponse),
        timestamp: new Date(),
        role: "assistant",
      });

      return [userMessage, assistantMessage];
    } catch (error) {
      console.error("Error processing message:", error);
      throw error;
    }
  }

  private async ensureValidChatId(
    chatId: string,
    userId: string
  ): Promise<string> {
    if (this.isValidUUID(chatId)) {
      const chatExists = await this.pool.query(
        "SELECT id FROM chatbot.chats WHERE id = $1",
        [chatId]
      );
      if (chatExists.rows.length > 0) {
        return chatId;
      }
    }
    return await this.createChat(userId);
  }

  async createChat(userId: string): Promise<string> {
    const chatId = uuidv4();
    await this.pool.query(
      "INSERT INTO chatbot.chats (id, user_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())",
      [chatId, userId]
    );
    return chatId;
  }

  // Cleanup method for graceful shutdown
  async cleanup() {
    await this.pool.end();
    this.messageCache.close();
  }
}
