import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { ChatService } from "./services/chat";
import { ChatEvent } from "./types";

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const chatService = new ChatService();

// Chat endpoints
app.post("/api/chat", async (req, res) => {
  try {
    // Removed userId parameter
    const chatId = await chatService.createChat();
    res.json({ chatId });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

app.get("/api/chat/:chatId/history", async (req, res) => {
  try {
    const { chatId } = req.params;
    const history = await chatService.getChatHistory(chatId);
    res.json(history);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// Socket connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-chat", async (chatId: string) => {
    try {
      // Join the socket to this room
      socket.join(chatId);

      // Check if this is a valid chat ID
      if (chatService.isValidUUID(chatId)) {
        const chatExists = await chatService.chatExists(chatId);

        if (!chatExists) {
          // This is a valid UUID from localStorage but doesn't exist in DB
          // We'll create it with this ID to preserve the client's history reference
          console.log("Creating chat with client-provided ID:", chatId);
        }
      } else {
        // Invalid UUID provided, we'll need to create a new one
        // This will happen when join-chat is called but client had no saved ID
        const newChatId = await chatService.createChat();
        socket.emit("chat-created", newChatId);
        socket.join(newChatId); // Join the new room
        chatId = newChatId;
      }

      // Get chat history
      const history = await chatService.getChatHistory(chatId);
      socket.emit("chat-history", history);

      // Check if terms are accepted for this chat
      const termsAccepted = await chatService.isChatTermsAccepted(chatId);
      socket.emit("terms-status", { accepted: termsAccepted });
    } catch (error) {
      console.error("Error joining chat:", error);
      socket.emit("error", { message: "Failed to join chat" });
    }
  });

  socket.on("check-terms-status", async (data: { chatId: string }) => {
    try {
      const { chatId } = data;
      const termsAccepted = await chatService.isChatTermsAccepted(chatId);
      console.log("Terms status check:", { chatId, termsAccepted });
      socket.emit("terms-status", { accepted: termsAccepted });
    } catch (error) {
      console.error("Error checking terms status:", error);
      socket.emit("error", { message: "Failed to check terms status" });
    }
  });

  socket.on("accept-terms", async (data: { chatId: string }) => {
    try {
      console.log("Terms acceptance received:", data);
      const { chatId } = data;

      // Register terms acceptance and get welcome message
      const welcomeMessage = await chatService.acceptTermsAndConditions(chatId);

      // Emit terms accepted status
      socket.emit("terms-status", { accepted: true });

      // Send welcome message to the client
      socket.emit("new-messages", [welcomeMessage]);
    } catch (error) {
      console.error("Error accepting terms:", error);
      socket.emit("error", {
        message: "Failed to accept terms and conditions",
      });
    }
  });

  socket.on("send-message", async (data: ChatEvent) => {
    try {
      const { chatId, content } = data;

      // Check if terms are accepted before processing messages
      const termsAccepted = await chatService.isChatTermsAccepted(chatId);
      if (!termsAccepted) {
        socket.emit("error", {
          message: "Please accept the terms and conditions first",
        });
        return;
      }

      const messages = await chatService.processUserMessage(chatId, content);

      io.to(chatId).emit("new-messages", messages);
    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  socket.on("typing-start", (chatId: string) => {
    socket.to(chatId).emit("user-typing", true);
  });

  socket.on("typing-end", (chatId: string) => {
    socket.to(chatId).emit("user-typing", false);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
  }
);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  await chatService.cleanup();
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
