# Chatbot API

This is a Node.js and Express-based chatbot API that utilizes Socket.io for real-time communication and Gemini AI for AI-powered responses. The API also integrates PostgreSQL for chat history storage, PDF document processing for context-aware responses, and caching for performance optimization.

## Features

- Real-time chat with WebSocket support
- AI-powered responses using Gemini AI
- PDF document upload and processing for context-aware responses
- Vector-based document search for relevant information retrieval
- PostgreSQL database for chat history storage
- Caching with NodeCache to improve response times
- Performance monitoring and health metrics

## Installation

### Prerequisites

- Node.js (v16 or later)
- PostgreSQL

### Setup

1. Clone the repository:

   ```sh
   git clone <repository_url>
   cd chatbot-api
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Create a `.env` file in the root directory and configure the following environment variables:

   ```env
   PORT=3000
   FRONTEND_URL=http://localhost:5173
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_HOST=localhost
   DB_NAME=chatbot
   DB_PORT=5432
   DB_POOL_SIZE=20
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. Set up the PostgreSQL database:

   ```sh
   psql -U your_db_user -d chatbot -f schema.sql
   ```

5. Start the server:
   ```sh
   npm run dev
   ```

### WebSocket Events

#### Client -> Server

- `join-chat` (chatId: string) - Joins a chat and fetches history.
- `send-message` ({ chatId: string, content: string }) - Sends a new message.
- `typing-start` (chatId: string) - Indicates user has started typing.
- `typing-end` (chatId: string) - Indicates user has stopped typing.

#### Server -> Client

- `chat-history` (messages: Message[]) - Returns chat history.
- `new-messages` (messages: Message[]) - Sends new messages.
- `error` ({ message: string }) - Sends an error message.
- `chat-created` (chatId: string) - Sends newly created chat ID.
- `user-typing` (isTyping: boolean) - Indicates if a user is typing.

## API Endpoints

### Chat Management

- `POST /api/chat` - Creates a new chat session and returns the chat ID.
- `GET /api/chat/:chatId/history` - Retrieves chat history for a specific chat.

### PDF Document Management

- `POST /api/pdf/upload` - Uploads a PDF document (multipart/form-data with 'pdf' field).
- `GET /api/pdf/list` - Lists all uploaded PDF documents.
- `DELETE /api/pdf/:documentId` - Deletes a specific PDF document.

## PDF Processing

The chatbot API includes PDF document processing capabilities that allow it to:

1. Upload and store PDF documents
2. Extract text content from PDFs
3. Split PDF content into searchable chunks
4. Perform vector-based similarity search to find relevant content
5. Use PDF content to provide context-aware responses

When a user asks a question, the system:

1. Searches for relevant PDF content using vector similarity
2. Includes the most relevant content as context for the Gemini AI model
3. Generates responses based on both the conversation history and PDF context

## Gemini AI Integration

The chatbot uses Google's Gemini AI to generate responses. Key features include:

1. Context-aware responses using conversation history
2. PDF document context integration for more accurate answers
3. System prompts to guide the AI's behavior and tone
4. Safety settings to ensure appropriate content
5. Customizable generation parameters
