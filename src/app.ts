import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "temp");
    // Ensure the directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// Chat endpoints
app.post("/api/chat", async (_req, res) => {
  try {
    // Removed userId parameter
    const chatId = await chatService.createChat();
    res.json({ chatId });
    return;
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
    return;
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

// PDF management endpoints
app.post("/api/pdf/upload", upload.single("pdf"), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No PDF file uploaded" });
      return;
    }

    const originalName = req.file.originalname || "unnamed.pdf";

    // Use Promise to handle the async operation
    chatService
      .uploadPDF(req.file.path, originalName)
      .then((documentId) => {
        res.json({
          success: true,
          documentId,
          name: originalName,
        });
      })
      .catch((error) => {
        console.error("Error uploading PDF:", error);
        res.status(500).json({ error: "Failed to upload PDF" });
      });
  } catch (error) {
    console.error("Error uploading PDF:", error);
    res.status(500).json({ error: "Failed to upload PDF" });
  }
});

app.get("/api/pdf/list", (_req, res) => {
  try {
    const documents = chatService.getAllPDFDocuments();

    // Return only the necessary information
    const documentList = documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      pageCount: doc.metadata.pageCount,
      createdAt: doc.metadata.createdAt,
      fileSize: doc.metadata.fileSize,
    }));

    res.json(documentList);
    return;
  } catch (error) {
    console.error("Error listing PDFs:", error);
    res.status(500).json({ error: "Failed to list PDFs" });
  }
});

app.delete("/api/pdf/:documentId", async (req, res) => {
  try {
    const { documentId } = req.params;
    const success = chatService.deletePDFDocument(documentId);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Document not found" });
    }
    return;
  } catch (error) {
    console.error("Error deleting PDF:", error);
    res.status(500).json({ error: "Failed to delete PDF" });
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

      // Send welcome message if this is a new chat (no history)
      if (history.length === 0) {
        console.log("Sending welcome message for new chat:", chatId);
        const welcomeMessage = await chatService.sendWelcomeMessage(chatId);
        socket.emit("new-messages", [welcomeMessage]);
      }
    } catch (error) {
      console.error("Error joining chat:", error);
      socket.emit("error", { message: "Failed to join chat" });
    }
  });

  socket.on("send-message", async (data: ChatEvent) => {
    try {
      const { chatId, content } = data;

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

  socket.on(
    "reset-chat",
    async (data: { chatId: string; clientProvidedId?: string }) => {
      try {
        const { chatId, clientProvidedId } = data;
        console.log(
          `Resetting chat ${chatId} with client provided ID: ${
            clientProvidedId || "none"
          }`
        );

        // Leave the current chat room
        socket.leave(chatId);

        // Create a new chat with the client provided ID or generate a new one
        let newChatId: string;

        if (clientProvidedId && chatService.isValidUUID(clientProvidedId)) {
          // Check if the client provided ID already exists
          const chatExists = await chatService.chatExists(clientProvidedId);

          if (chatExists) {
            // If it exists, we'll use a new random ID instead
            newChatId = await chatService.createChat();
            console.log(
              `Client provided ID ${clientProvidedId} already exists, using new ID: ${newChatId}`
            );
          } else {
            // Use the client provided ID to create a new chat
            try {
              newChatId = await chatService.createChatWithId(clientProvidedId);
            } catch (error) {
              console.error(
                `Error creating chat with ID ${clientProvidedId}:`,
                error
              );
              // Fallback to creating a new chat with a random ID
              newChatId = await chatService.createChat();
            }
            console.log(
              `Created new chat with client provided ID: ${newChatId}`
            );
          }
        } else {
          // Generate a new chat ID
          newChatId = await chatService.createChat();
          console.log(`Created new chat with generated ID: ${newChatId}`);
        }

        // Join the new chat room
        socket.join(newChatId);

        // Send the new chat ID to the client
        socket.emit("chat-reset", { oldChatId: chatId, newChatId });

        // Send welcome message for the new chat
        const welcomeMessage = await chatService.sendWelcomeMessage(newChatId);
        socket.emit("new-messages", [welcomeMessage]);

        console.log(`Chat reset complete: ${chatId} -> ${newChatId}`);
      } catch (error) {
        console.error("Error resetting chat:", error);
        socket.emit("error", { message: "Failed to reset chat" });
      }
    }
  );

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
