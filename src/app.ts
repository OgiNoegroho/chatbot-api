// src/app.ts
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { ChatService } from "./services/chat";
import { PerformanceMonitor } from "./services/performance";
import trainingRoutes from "./routes/training.routes";

const app = express();
// Add JSON body parser
app.use(express.json());

// Register training routes
app.use("/training", trainingRoutes);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

const performanceMonitor = new PerformanceMonitor();
const chatService = new ChatService();

// Health and monitoring endpoints
app.get("/health", (req, res) => {
  const health = performanceMonitor.getHealthMetrics();
  res.json(health);
});

app.get("/metrics", (req, res) => {
  const metrics = performanceMonitor.getDetailedMetrics();
  res.json(metrics);
});

// Socket connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  performanceMonitor.trackConnection();

  socket.on("join-chat", async (chatId: string) => {
    const startTime = Date.now();

    socket.join(chatId);
    const history = await chatService.getChatHistory(chatId);
    socket.emit("chat-history", history);

    performanceMonitor.trackOperation("chat-history", Date.now() - startTime);
  });

  socket.on(
    "send-message",
    async (data: { chatId: string; userId: string; content: string }) => {
      const startTime = Date.now();

      try {
        const messages = await chatService.processUserMessage(
          data.chatId,
          data.userId,
          data.content
        );
        io.to(data.chatId).emit("new-messages", messages);

        performanceMonitor.trackOperation(
          "message-processing",
          Date.now() - startTime
        );
      } catch (error) {
        performanceMonitor.trackError("message-processing");
        socket.emit("error", { message: "Failed to process message" });
      }
    }
  );

  socket.on("disconnect", () => {
    performanceMonitor.trackDisconnection();
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

