// src/types/training.ts
interface TrainingDocument {
  id: string;
  source: string;
  content: string;
  metadata: {
    title?: string;
    url?: string;
    author?: string;
    date?: Date;
    fileType: "web" | "pdf";
  };
  chunks: string[];
  created_at: Date;
}
