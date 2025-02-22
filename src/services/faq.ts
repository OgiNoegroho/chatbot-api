// src/services/faq.ts
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  contextTags: string[];
}

interface UserPermission {
  userId: string;
  allowedContexts: string[];
  isApproved: boolean;
  approvedAt?: Date;
}

export class FAQContextService {
  private pool: Pool;
  private readonly REQUIRED_CONTEXTS = new Set([
    "general",
    "technical",
    "account",
    "billing",
    "security",
  ]);

  constructor(pool: Pool) {
    this.pool = pool;
    this.initializeTables();
  }

  private async initializeTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot.faqs (
        id UUID PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        context_tags TEXT[] NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chatbot.user_permissions (
        user_id UUID PRIMARY KEY,
        allowed_contexts TEXT[] NOT NULL,
        is_approved BOOLEAN DEFAULT FALSE,
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async addFAQ(faq: Omit<FAQ, "id">): Promise<FAQ> {
    const id = uuidv4();
    const result = await this.pool.query(
      "INSERT INTO chatbot.faqs (id, question, answer, category, context_tags) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [id, faq.question, faq.answer, faq.category, faq.contextTags]
    );
    return result.rows[0];
  }

  async getFAQsByContext(contextTags: string[]): Promise<FAQ[]> {
    const result = await this.pool.query(
      "SELECT * FROM chatbot.faqs WHERE context_tags && $1",
      [contextTags]
    );
    return result.rows;
  }

  async requestPermission(userId: string, contexts: string[]): Promise<void> {
    const validContexts = contexts.filter((context) =>
      this.REQUIRED_CONTEXTS.has(context)
    );

    await this.pool.query(
      "INSERT INTO chatbot.user_permissions (user_id, allowed_contexts, is_approved) VALUES ($1, $2, FALSE)",
      [userId, validContexts]
    );
  }

  async approvePermission(userId: string): Promise<void> {
    await this.pool.query(
      "UPDATE chatbot.user_permissions SET is_approved = TRUE, approved_at = CURRENT_TIMESTAMP WHERE user_id = $1",
      [userId]
    );
  }

  async getUserPermissions(userId: string): Promise<UserPermission | null> {
    const result = await this.pool.query(
      "SELECT * FROM chatbot.user_permissions WHERE user_id = $1",
      [userId]
    );
    return result.rows[0] || null;
  }

  async isUserAuthorized(
    userId: string,
    requiredContexts: string[]
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    if (!permissions || !permissions.isApproved) return false;

    return requiredContexts.every((context) =>
      permissions.allowedContexts.includes(context)
    );
  }

  extractContextFromMessage(message: string): string[] {
    const contexts: string[] = [];

    // Add context detection logic based on keywords or patterns
    if (message.match(/\b(password|login|auth|security)\b/i)) {
      contexts.push("security");
    }
    if (message.match(/\b(pay|cost|price|billing|subscription)\b/i)) {
      contexts.push("billing");
    }
    if (message.match(/\b(account|profile|settings)\b/i)) {
      contexts.push("account");
    }
    if (message.match(/\b(api|code|error|bug|implementation)\b/i)) {
      contexts.push("technical");
    }

    // Add 'general' if no specific context is detected
    if (contexts.length === 0) {
      contexts.push("general");
    }

    return contexts;
  }
}
