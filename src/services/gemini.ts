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
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 1024,
    };

    // Define your system prompt
    this.systemPrompt = `Peran:
    Anda adalah Asisten Virtual DPMPTSP yang bertugas memberikan informasi, panduan, dan bantuan terkait layanan perizinan dan investasi. Anda harus responsif, informatif, dan menggunakan bahasa yang jelas serta mudah dipahami oleh masyarakat umum.
    
    Tanggung Jawab Utama:
    1. Memberikan Informasi Umum tentang DPMPTSP dan layanannya
    2. Memberikan panduan lengkap tentang layanan perizinan
    3. Menggunakan bahasa yang sopan, formal, namun tetap ramah`;

    this.initializeChat();
  }

  private initializeChat(): void {
    // Initialize chat with system prompt
    this.chat = this.model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "System: " + this.systemPrompt }],
        },
        {
          role: "model",
          parts: [
            {
              text: "Saya mengerti dan akan berperan sebagai Asisten Virtual DPMPTSP sesuai panduan yang diberikan.",
            },
          ],
        },
      ],
      safetySettings: this.safetySettings,
      generationConfig: this.generationConfig,
    });
  }

  public async generateResponse(
    userMessage: string,
    context?: { history: Array<{ role: string; content: string }> }
  ): Promise<string> {
    try {
      if (context?.history && context.history.length > 0) {
        // Initialize new chat with system prompt first
        const newChat = this.model.startChat({
          history: [
            {
              role: "user",
              parts: [{ text: "System: " + this.systemPrompt }],
            },
            {
              role: "model",
              parts: [
                {
                  text: "Saya mengerti dan akan berperan sebagai Asisten Virtual DPMPTSP sesuai panduan yang diberikan.",
                },
              ],
            },
          ],
          safetySettings: this.safetySettings,
          generationConfig: this.generationConfig,
        });

        // Add conversation history
        for (const msg of context.history) {
          if (msg.role === "user") {
            await newChat.sendMessage(msg.content);
          }
        }

        // Use the new chat with history
        this.chat = newChat;
      }

      const result = await this.chat.sendMessage(userMessage);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error("Error generating AI response:", error);
      throw new Error("Failed to generate AI response");
    }
  }

  async generateWelcomeMessage(): Promise<string> {
    try {
      // Initialize a new chat session with the system prompt
      const welcomeChat = this.model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: "System: " + this.systemPrompt }],
          },
          {
            role: "model",
            parts: [
              {
                text: "Saya mengerti dan akan berperan sebagai Asisten Virtual DPMPTSP sesuai panduan yang diberikan.",
              },
            ],
          },
        ],
        safetySettings: this.safetySettings,
        generationConfig: this.generationConfig,
      });

      // Call Gemini with a specific prompt to generate the welcome message
      const result = await welcomeChat.sendMessage(
        "Berikan pesan sambutan singkat dan ramah dalam Bahasa Indonesia untuk pengguna yang baru menyetujui syarat dan ketentuan layanan chat DPMPTSP. Perkenalkan diri sebagai asisten virtual DPMPTSP dan tanyakan bagaimana Anda dapat membantu mereka terkait layanan perizinan dan investasi. Batasi hingga 200 karakter."
      );

      const response = await result.response;
      const welcomeText = response.text();

      return (
        welcomeText ||
        "Halo! Terima kasih telah menyetujui syarat dan ketentuan kami. Saya asisten virtual DPMPTSP, siap membantu Anda dengan informasi perizinan dan investasi. Ada yang bisa saya bantu hari ini?"
      );
    } catch (error) {
      console.error("Error in Gemini welcome message generation:", error);
      // Return a default message if something goes wrong
      return "Halo! Terima kasih telah menyetujui syarat dan ketentuan kami. Saya asisten virtual DPMPTSP, siap membantu Anda dengan informasi perizinan dan investasi. Ada yang bisa saya bantu hari ini?";
    }
  }
}
