// src/types/index.ts
export interface Message {
  id: string;
  chatId: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
}

export interface ChatEvent {
  chatId: string;
  content: string;
}