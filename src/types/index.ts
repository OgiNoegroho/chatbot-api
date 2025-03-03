// src/types/index.ts
export interface ChatHistory {
  role: string;
  content: string;
}

export interface Message extends ChatHistory {
  id: string;
  userId: string;
  chatId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ChatEvent {
  chatId: string;
  userId: string;
  content: string;
}