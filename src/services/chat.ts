// src/services/chat.ts
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { OllamaService } from "./ollama";
import NodeCache from "node-cache";

export interface Message {
  id: string;
  chatId: string;
  userId: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
}

interface UserConsent {
  userId: string;
  hasAccepted: boolean;
  acceptedAt?: Date;
  ipAddress?: string;
}

export class ChatService {
  private pool: Pool;
  private ollamaService: OllamaService;
  private messageCache: NodeCache;
  private readonly CACHE_TTL = 3600; // 1 hour in seconds
  private readonly MAX_MESSAGE_LENGTH = 2000;
  private readonly MAX_HISTORY_MESSAGES = 50;
  private readonly CONSENT_MESSAGE = `
Before we begin, please be aware of the following:

1. This is an AI chatbot that uses machine learning to generate responses
2. While we strive for accuracy, responses may not always be perfect
3. Do not share sensitive personal information
4. Conversations may be logged for quality improvement
5. The chatbot should not be used for critical decisions

Do you accept these terms? Please reply with "I accept" to continue.`;

  constructor() {
    // Initialize PostgreSQL pool
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

    // Initialize cache
    this.messageCache = new NodeCache({
      stdTTL: this.CACHE_TTL,
      checkperiod: 120,
      maxKeys: 1000,
      useClones: false,
    });

    this.ollamaService = new OllamaService();

    // Initialize tables
    this.initializeTables();

    // Handle pool errors
    this.pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }

  private async initializeTables() {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS chatbot;
      
      CREATE TABLE IF NOT EXISTS chatbot.chats (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chatbot.messages (
        id UUID PRIMARY KEY,
        chat_id UUID REFERENCES chatbot.chats(id),
        user_id UUID NOT NULL,
        content TEXT NOT NULL,
        role VARCHAR(10) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chatbot.user_consent (
        user_id UUID PRIMARY KEY,
        has_accepted BOOLEAN DEFAULT FALSE,
        accepted_at TIMESTAMP,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chatbot.messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chatbot.messages(timestamp);
    `);
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

  async checkUserConsent(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT has_accepted FROM chatbot.user_consent WHERE user_id = $1",
      [userId]
    );
    return result.rows.length > 0 && result.rows[0].has_accepted;
  }

  async recordUserConsent(userId: string, ipAddress?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO chatbot.user_consent (user_id, has_accepted, accepted_at, ip_address)
       VALUES ($1, TRUE, CURRENT_TIMESTAMP, $2)
       ON CONFLICT (user_id) 
       DO UPDATE SET has_accepted = TRUE, accepted_at = CURRENT_TIMESTAMP`,
      [userId, ipAddress]
    );
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

    this.messageCache.del(chatId);
    return result.rows[0];
  }

  async processUserMessage(
    chatId: string,
    userId: string,
    content: string,
    ipAddress?: string
  ): Promise<Message[]> {
    const validChatId = await this.ensureValidChatId(chatId, userId);

    // Save user message
    const userMessage = await this.saveMessage(validChatId, {
      userId,
      content: this.truncateMessage(content),
      timestamp: new Date(),
      role: "user",
      chatId: validChatId,
    });

    // Check if user has already consented
    const hasConsent = await this.checkUserConsent(userId);

    if (!hasConsent) {
      if (content.toLowerCase().trim() === "i accept") {
        await this.recordUserConsent(userId, ipAddress);

        const confirmationMessage = await this.saveMessage(validChatId, {
          userId,
          content: "Thank you for accepting. How can I help you today?",
          timestamp: new Date(),
          role: "assistant",
          chatId: validChatId,
        });
        return [userMessage, confirmationMessage];
      } else {
        const consentMessage = await this.saveMessage(validChatId, {
          userId,
          content: this.CONSENT_MESSAGE,
          timestamp: new Date(),
          role: "assistant",
          chatId: validChatId,
        });
        return [userMessage, consentMessage];
      }
    }

    try {
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
        chatId: validChatId,
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

  async cleanup() {
    await this.pool.end();
    this.messageCache.close();
  }
}
