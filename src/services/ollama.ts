// src/services/ollama.ts
import axios from "axios";
import { Agent } from "http";

interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
  numThread?: number;
  numGpu?: number;
  timeout?: number;
}

export class OllamaService {
  private readonly config: Required<OllamaConfig>;
  private readonly httpAgent: Agent;

  constructor(config?: OllamaConfig) {
    this.config = {
      baseUrl:
        config?.baseUrl ??
        process.env.OLLAMA_API_URL ??
        "http://localhost:11434",
      model: config?.model ?? "deepseek-r1:1.5b",
      temperature: config?.temperature ?? 0.7,
      topK: config?.topK ?? 40,
      topP: config?.topP ?? 0.9,
      numThread: config?.numThread ?? 4,
      numGpu: config?.numGpu ?? 1,
      timeout: config?.timeout ?? 15000,
    };

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
        `${this.config.baseUrl}/api/generate`,
        {
          model: this.config.model,
          prompt,
          stream: false,
          options: {
            num_gpu: this.config.numGpu,
            num_thread: this.config.numThread,
            temperature: this.config.temperature,
            top_k: this.config.topK,
            top_p: this.config.topP,
          },
        },
        {
          httpAgent: this.httpAgent,
          timeout: this.config.timeout,
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
