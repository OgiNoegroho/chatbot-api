import axios from "axios";
import { Agent } from "http";

export class OllamaService {
  private baseUrl: string;
  private httpAgent: Agent;

  constructor() {
    this.baseUrl = process.env.OLLAMA_API_URL || "http://localhost:11434";
    this.httpAgent = new Agent({
      keepAlive: true,
      maxSockets: 100,
      maxFreeSockets: 10,
      timeout: 30000,
    });
  }

  async generateResponse(prompt: string): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: "deepseek-r1:1.5b",
          prompt,
          stream: false,
          options: {
            num_gpu: 1,
            num_thread: 4,
            temperature: 0.7,
            top_k: 40,
            top_p: 0.9,
          },
        },
        {
          httpAgent: this.httpAgent,
          timeout: 15000,
        }
      );

      return response.data.response
        .replace(/<think>\s*/, "")
        .replace(/\s*<\/think>/, "");
    } catch (error) {
      console.error("Ollama API error:", error);
      throw new Error("Failed to generate AI response");
    }
  }
}
