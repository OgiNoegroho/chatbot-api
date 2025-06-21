# Rancangan Database Aplikasi Chatbot (Current Implementation)

## Overview

Dokumentasi ini menjelaskan struktur database yang saat ini digunakan dalam aplikasi chatbot backend. Database menggunakan PostgreSQL dengan schema `chatbot`.

## Database Configuration

### Environment Variables

```env
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=localhost
DB_NAME=chatbot
DB_PORT=5432
DB_POOL_SIZE=20
```

### Connection Pool Settings

- **Max Connections**: 20
- **Idle Timeout**: 30 seconds
- **Connection Timeout**: 2 seconds

## Database Schema

### 1. Schema Utama

```sql
CREATE SCHEMA IF NOT EXISTS chatbot;
```

### 2. Tabel `chatbot.chats`

Menyimpan informasi sesi chat.

```sql
CREATE TABLE IF NOT EXISTS chatbot.chats (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Struktur Kolom:**

- `id` (UUID, Primary Key): Identifier unik untuk setiap chat session
- `created_at` (TIMESTAMP): Waktu pembuatan chat
- `updated_at` (TIMESTAMP): Waktu terakhir chat diupdate

**Karakteristik:**

- Menggunakan UUID sebagai primary key untuk keamanan dan uniqueness
- Auto-generated timestamps untuk tracking
- Tidak ada foreign key ke user (aplikasi saat ini tidak memiliki sistem user)

### 3. Tabel `chatbot.messages`

Menyimpan semua pesan dalam chat.

```sql
CREATE TABLE IF NOT EXISTS chatbot.messages (
  id UUID PRIMARY KEY,
  chat_id UUID REFERENCES chatbot.chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Struktur Kolom:**

- `id` (UUID, Primary Key): Identifier unik untuk setiap message
- `chat_id` (UUID, Foreign Key): Referensi ke tabel chats
- `content` (TEXT): Isi pesan (maksimal 4096 karakter di aplikasi)
- `role` (VARCHAR(10)): Peran pengirim pesan ('user' atau 'assistant')
- `timestamp` (TIMESTAMP): Waktu pesan dikirim

**Constraints:**

- `role` hanya boleh 'user' atau 'assistant'
- `content` tidak boleh NULL
- Cascade delete: jika chat dihapus, semua messages ikut terhapus

### 4. Indexes

```sql
-- Index untuk optimasi query messages berdasarkan chat_id
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chatbot.messages(chat_id);

-- Index untuk optimasi query messages berdasarkan timestamp
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chatbot.messages(timestamp);
```

**Tujuan Indexes:**

- `idx_messages_chat_id`: Mempercepat query untuk mengambil history chat
- `idx_messages_timestamp`: Mempercepat query berdasarkan waktu (sorting, filtering)

## Data Flow dan Business Logic

### 1. Chat Creation

```typescript
// Membuat chat baru
async createChat(): Promise<string> {
  const chatId = uuidv4();
  await this.pool.query(
    "INSERT INTO chatbot.chats (id, created_at, updated_at) VALUES ($1, NOW(), NOW())",
    [chatId]
  );
  return chatId;
}
```

### 2. Message Storage

```typescript
// Menyimpan pesan
async saveMessage(chatId: string, message: Omit<Message, "id">): Promise<Message> {
  const messageId = uuidv4();
  const truncatedContent = this.truncateMessage(message.content); // Max 4096 chars

  const result = await this.pool.query(
    "INSERT INTO chatbot.messages (id, chat_id, content, role, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [messageId, chatId, truncatedContent, message.role, message.timestamp]
  );

  return result.rows[0];
}
```

### 3. Chat History Retrieval

```typescript
// Mengambil history chat (maksimal 10 pesan terakhir)
async getChatHistory(chatId: string): Promise<Message[]> {
  const result = await this.pool.query(
    "SELECT * FROM chatbot.messages WHERE chat_id = $1 ORDER BY timestamp DESC LIMIT $2",
    [chatId, 10] // MAX_HISTORY_MESSAGES = 10
  );

  return result.rows.reverse(); // Reverse untuk urutan chronological
}
```

## Caching Strategy

### 1. NodeCache Implementation

```typescript
private messageCache: NodeCache = new NodeCache({
  stdTTL: 3600,        // 1 hour TTL
  checkperiod: 120,    // Check expired keys every 2 minutes
  maxKeys: 1000,       // Maximum 1000 cached items
  useClones: false     // Performance optimization
});
```

### 2. Cache Usage

- **Chat History**: Di-cache setelah query pertama
- **Cache Invalidation**: Cache dihapus setelah message baru disimpan
- **Cache Key**: Menggunakan `chatId` sebagai key

## Data Storage Lainnya (Non-Database)

### 1. PDF Documents

**Storage Location**: `uploads/pdfs/`
**File Naming**: `{documentId}.pdf`

**In-Memory Storage** (PDFService):

```typescript
private documents: Map<string, PDFDocument> = new Map();
```

**PDFDocument Structure**:

```typescript
interface PDFDocument {
  id: string;
  name: string;
  path: string;
  content: string;
  chunks: PDFChunk[];
  metadata: {
    pageCount: number;
    createdAt: Date;
    fileSize: number;
  };
}
```

### 2. Vector Embeddings

**Storage**: In-Memory Map

```typescript
private vectorEntries: Map<string, VectorEntry> = new Map();
```

**VectorEntry Structure**:

```typescript
interface VectorEntry {
  id: string;
  chunkId: string;
  documentId: string;
  vector: number[];
  content: string;
  metadata: any;
}
```

## Performance Optimizations

### 1. Database Level

- **Connection Pooling**: Maksimal 20 koneksi simultan
- **Prepared Statements**: Menggunakan parameterized queries
- **Indexes**: Optimasi untuk query yang sering digunakan

### 2. Application Level

- **Message Truncation**: Maksimal 4096 karakter per pesan
- **History Limit**: Maksimal 10 pesan terakhir per query
- **Caching**: NodeCache untuk chat history
- **PDF Chunks Limit**: Maksimal 2 chunks per search

### 3. Memory Management

- **Cache TTL**: 1 jam untuk chat history
- **Cache Size Limit**: Maksimal 1000 items
- **Vector Store**: In-memory untuk performa search yang cepat

## Limitations & Considerations

### 1. Current Limitations

- **No User Management**: Tidak ada tabel users
- **No PDF Persistence**: PDF metadata tidak disimpan di database
- **Vector Persistence Issue**: Vector embeddings hanya di memory (akan diupgrade ke pgvector)
- **No Analytics**: Tidak ada tracking usage atau performance metrics

### 2. Data Persistence

- **Database**: Chat sessions dan messages
- **File System**: PDF files di `uploads/pdfs/`
- **Memory**: PDF chunks dan vector embeddings (akan dipindah ke database)

### 3. Scalability Considerations

- Vector store akan hilang saat aplikasi restart (akan diperbaiki dengan pgvector)
- PDF processing harus diulang setiap restart
- Tidak ada backup untuk in-memory data

## API Endpoints yang Menggunakan Database

### 1. Chat Endpoints

- `POST /api/chat` → Creates new chat in database
- `GET /api/chat/:chatId/history` → Retrieves messages from database

### 2. WebSocket Events

- `send-message` → Saves user message and AI response to database
- `join-chat` → Validates chat existence in database

## Environment Setup

### 1. Database Setup

```bash
# Create database
createdb chatbot

# Run application (auto-creates tables)
npm run dev
```

### 2. Required Directories

```bash
mkdir -p uploads/pdfs
mkdir -p uploads/temp
```

Aplikasi akan otomatis membuat tabel-tabel yang diperlukan saat pertama kali dijalankan melalui method `initializeTables()` di ChatService.
