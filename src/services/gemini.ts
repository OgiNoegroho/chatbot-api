import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
  ChatSession,
  SafetySetting,
  GenerationConfig,
} from "@google/generative-ai";

export class GeminiService {
  private model: GenerativeModel;
  private chat!: ChatSession;
  private readonly safetySettings: SafetySetting[];
  private readonly generationConfig: GenerationConfig;
  private readonly systemPrompt: string;

  constructor() {
    // Define system prompt first
    this.systemPrompt = `Peran:
    Anda adalah Asisten Virtual DPMPTSP yang bertugas memberikan informasi, panduan, dan bantuan terkait layanan perizinan dan investasi. Anda harus responsif, informatif, dan menggunakan bahasa yang jelas serta mudah dipahami oleh masyarakat umum.

    Tanggung Jawab Utama:
    1. Memberikan Informasi Umum tentang DPMPTSP dan layanannya
    2. Memberikan panduan lengkap tentang layanan perizinan
    3. Menggunakan bahasa yang sopan, formal, namun tetap ramah

    Aturan Penting:
    1. JANGAN PERNAH menyebutkan "berdasarkan dokumen" atau "dokumen yang diberikan" dalam jawaban Anda
    2. Jawab seolah-olah informasi ini adalah pengetahuan umum Anda tentang DPMPTSP
    3. Jika Anda tidak memiliki informasi yang cukup, sarankan pengguna untuk menghubungi DPMPTSP melalui email atau website resmi`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    // Use the fastest model available - gemini-1.5-flash is optimized for speed
    this.model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: this.systemPrompt, // Add system instruction directly for faster initialization
    });

    this.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];

    this.generationConfig = {
      temperature: 0.5, // Lower temperature for faster, more deterministic responses
      topK: 20, // Lower topK for faster generation
      topP: 0.8, // Lower topP for faster generation
      maxOutputTokens: 512, // Reduced max tokens to speed up generation
    };

    // System prompt is already defined above

    this.initializeChat();
  }

  private initializeChat(): void {
    // Initialize chat with minimal history since we're using systemInstruction
    this.chat = this.model.startChat({
      // No need for history when using systemInstruction
      safetySettings: this.safetySettings,
      generationConfig: this.generationConfig,
    });
  }

  private checkResponseQuality(response: string): boolean {
    // Check if the response contains the "no information" message
    if (response.includes("tidak memiliki informasi yang cukup")) {
      return true; // This is an acceptable "no info" response
    }

    // Check minimum length for a substantive response
    if (response.length < 50) {
      return false;
    }

    return true;
  }

  public async generateResponse(
    userMessage: string,
    context?: {
      history: Array<{ role: string; content: string }>;
      pdfContext?: {
        chunks: Array<{ content: string; documentId: string }>;
        documentNames?: Record<string, string>;
      };
    }
  ): Promise<string> {
    try {
      // Initialize a new chat for each request to avoid state issues
      const newChat = this.model.startChat({
        safetySettings: this.safetySettings,
        generationConfig: this.generationConfig,
      });

      // Only include the most recent history (last 3 messages) to reduce context size
      if (context?.history && context.history.length > 0) {
        // Get only the last few messages to reduce context size
        const recentHistory = context.history.slice(-3);

        // Add minimal conversation history
        let historyToAdd = [];
        for (const msg of recentHistory) {
          historyToAdd.push({
            role: msg.role === "user" ? "user" : "model",
            parts: [{ text: msg.content }],
          });
        }

        // Use the new chat with limited history
        this.chat = newChat;
      }

      // If we have PDF context, include it in the prompt
      let effectiveMessage = userMessage;

      if (
        context?.pdfContext &&
        context.pdfContext.chunks &&
        context.pdfContext.chunks.length > 0
      ) {
        // Limit to maximum 3 chunks to reduce context size
        const limitedChunks = context.pdfContext.chunks.slice(0, 3);

        // Format the PDF context more concisely
        const contextChunks = limitedChunks
          .map((chunk) => {
            // Document name not needed for concise format
            // Truncate chunk content if too long
            const truncatedContent =
              chunk.content.length > 300
                ? chunk.content.substring(0, 300) + "..."
                : chunk.content;
            return `${truncatedContent}`;
          })
          .join("\n");

        console.log(
          `Using ${limitedChunks.length} PDF chunks (limited) for query: "${userMessage}"`
        );

        // Create a more concise prompt without mentioning documents
        effectiveMessage = `
Anda adalah asisten virtual DPMPTSP. Gunakan HANYA informasi berikut untuk menjawab:
${contextChunks}

Pertanyaan: ${userMessage}

PENTING:
1. JANGAN PERNAH menyebutkan "berdasarkan dokumen" atau "dokumen yang diberikan" dalam jawaban Anda
2. Jawab seolah-olah informasi ini adalah pengetahuan umum Anda tentang DPMPTSP
3. Jika informasi di atas TIDAK CUKUP untuk menjawab pertanyaan dengan baik, berikan respons: "Maaf, saya tidak memiliki informasi yang cukup untuk menjawab pertanyaan tersebut. Silakan hubungi DPMPTSP melalui email di info@dpmptsp.pekanbaru.go.id atau kunjungi website resmi kami."
4. JANGAN GUNAKAN pengetahuan umum Anda untuk menjawab pertanyaan - HANYA gunakan informasi yang diberikan di atas
`;
      } else {
        console.log(`No PDF context available for query: "${userMessage}"`);
        // If no PDF context is available, return a standard "no information" response
        return "Maaf, saya tidak memiliki informasi yang cukup untuk menjawab pertanyaan tersebut. Silakan hubungi DPMPTSP melalui email di info@dpmptsp.pekanbaru.go.id atau kunjungi website resmi kami untuk informasi lebih lanjut.";
      }

      console.log("Sending request to Gemini...");
      const result = await this.chat.sendMessage(effectiveMessage);
      const responseText = result.response.text();

      // Check response quality
      if (!this.checkResponseQuality(responseText)) {
        return "Maaf, saya tidak memiliki informasi yang cukup untuk menjawab pertanyaan tersebut. Silakan hubungi DPMPTSP melalui email di info@dpmptsp.pekanbaru.go.id atau kunjungi website resmi kami untuk informasi lebih lanjut.";
      }

      return responseText;
    } catch (error) {
      console.error("Error generating AI response:", error);
      // Add more detailed error logging
      if (error instanceof Error) {
        console.error("Error details:", error.message);
        console.error("Error stack:", error.stack);
      }
      throw new Error("Failed to generate AI response");
    }
  }

  async generateWelcomeMessage(): Promise<string> {
    // Use a pre-defined welcome message instead of generating one
    // This is much faster than calling the API
    return "Halo! Saya asisten virtual DPMPTSP, siap membantu Anda dengan informasi seputar layanan perizinan dan investasi di Kota Pekanbaru. Silakan ajukan pertanyaan Anda!";
  }
}
