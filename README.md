# Chatbot API

This is a Node.js and Express-based chatbot API that utilizes Socket.io for real-time communication and DeepSeek via Ollama for AI-powered responses. The API also integrates PostgreSQL for chat history storage and caching for performance optimization.

## Features
- Real-time chat with WebSocket support
- AI-powered responses using DeepSeek on Ollama
- PostgreSQL database for chat history storage
- Caching with NodeCache to improve response times
- Performance monitoring and health metrics

## Installation

### Prerequisites
- Node.js (v16 or later)
- PostgreSQL
- Docker (optional for running PostgreSQL locally)

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
   OLLAMA_API_URL=http://localhost:11434
   ```

4. Set up the PostgreSQL database:
   ```sh
   psql -U your_db_user -d chatbot -f schema.sql
   ```

5. Start the server:
   ```sh
   npm run dev
   ```

## API Endpoints

### Health & Monitoring
- `GET /health` - Returns basic health metrics.
- `GET /metrics` - Provides detailed performance metrics.

### WebSocket Events

#### Client -> Server
- `join-chat` (chatId: string) - Joins a chat and fetches history.
- `send-message` ({ chatId: string, userId: string, content: string }) - Sends a new message.

#### Server -> Client
- `chat-history` (messages: Message[]) - Returns chat history.
- `new-messages` (messages: Message[]) - Sends new messages.
- `error` ({ message: string }) - Sends an error message.

## Deployment

To deploy the chatbot API, use a process manager like PM2 or Docker:

### Using PM2
```sh
pm install -g pm2
pm run build
pm2 start dist/app.js --name chatbot-api
```

### Using Docker
1. Build the Docker image:
   ```sh
   docker build -t chatbot-api .
   ```
2. Run the container:
   ```sh
   docker run -d -p 3000:3000 --env-file .env chatbot-api
   ```

## License
This project is licensed under the MIT License.

