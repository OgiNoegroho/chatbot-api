// src/app.ts
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { ChatService } from "./services/chat";
import { rateLimit } from "express-rate-limit";

interface ChatEvent {
  chatId: string;
  userId: string;
  content: string;
}

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

// Basic health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
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

// Socket connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Join a specific chat room
  socket.on("join-chat", async (chatId: string) => {
    try {
      socket.join(chatId);
      const history = await chatService.getChatHistory(chatId);
      socket.emit("chat-history", history);
    } catch (error) {
      console.error("Error joining chat:", error);
      socket.emit("error", { message: "Failed to join chat" });
    }
  });

  // Handle incoming messages
  socket.on("send-message", async (data: ChatEvent) => {
    try {
      const ipAddress =
        socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;

      const messages = await chatService.processUserMessage(
        data.chatId,
        data.userId,
        data.content,
        typeof ipAddress === "string" ? ipAddress : ipAddress[0]
      );

      io.to(data.chatId).emit("new-messages", messages);
    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit("error", { message: "Failed to process message" });
    }
  });

  // Handle typing indicators
  socket.on("typing-start", (chatId: string) => {
    socket.to(chatId).emit("user-typing", true);
  });

  socket.on("typing-end", (chatId: string) => {
    socket.to(chatId).emit("user-typing", false);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

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
