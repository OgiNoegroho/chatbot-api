// src/types/index.ts
export interface Message {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
  role: "user" | "assistant";
  chatId?: string;
}

export interface Chat {
  id: string;
  userId: string;
  messages: Message[];
  created_at: Date;
  updated_at: Date;
}
