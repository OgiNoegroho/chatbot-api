# Implementasi pgvector untuk Vector Embeddings

## Overview
Dokumen ini menjelaskan implementasi pgvector untuk menyimpan vector embeddings secara persistent di PostgreSQL, menggantikan storage in-memory yang hilang saat restart.

## 1. Setup pgvector Extension

### Install pgvector di PostgreSQL

#### Untuk Ubuntu/Debian:
```bash
# Install dependencies
sudo apt update
sudo apt install postgresql-server-dev-all

# Clone dan compile pgvector
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

#### Untuk Windows (menggunakan pre-built):
```bash
# Download dari https://github.com/pgvector/pgvector/releases
# Extract dan copy ke PostgreSQL directory
```

#### Untuk Docker PostgreSQL:
```dockerfile
FROM postgres:15
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    postgresql-server-dev-15
RUN git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git && \
    cd pgvector && \
    make && \
    make install
```

### Enable Extension di Database
```sql
-- Connect ke database chatbot
\c chatbot

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT * FROM pg_extension WHERE extname = 'vector';
```

## 2. Database Schema Update

### Tabel untuk PDF Documents
```sql
-- Tabel untuk menyimpan metadata PDF
CREATE TABLE IF NOT EXISTS chatbot.pdf_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    page_count INTEGER,
    content_hash VARCHAR(64), -- SHA-256 hash
    upload_status VARCHAR(20) DEFAULT 'completed' CHECK (upload_status IN ('processing', 'completed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pdf_documents_hash ON chatbot.pdf_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_status ON chatbot.pdf_documents(upload_status);
```

### Tabel untuk PDF Chunks
```sql
-- Tabel untuk menyimpan chunks dari PDF
CREATE TABLE IF NOT EXISTS chatbot.pdf_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_length INTEGER NOT NULL,
    page_number INTEGER,
    section_title VARCHAR(255),
    chunk_type VARCHAR(50) DEFAULT 'text',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document_id ON chatbot.pdf_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_index ON chatbot.pdf_chunks(document_id, chunk_index);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_content_fts 
ON chatbot.pdf_chunks USING gin(to_tsvector('indonesian', content));
```

### Tabel untuk Vector Embeddings (pgvector)
```sql
-- Tabel untuk menyimpan vector embeddings menggunakan pgvector
CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
    document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
    embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
    embedding_vector vector(768), -- Gemini embedding-001 menggunakan 768 dimensions
    vector_dimension INTEGER NOT NULL DEFAULT 768,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes untuk pgvector
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_chunk_id ON chatbot.vector_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_document_id ON chatbot.vector_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_model ON chatbot.vector_embeddings(embedding_model);

-- Vector similarity index (HNSW untuk performa terbaik)
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops);

-- Alternative: IVFFlat index (lebih cepat untuk build, slower untuk query)
-- CREATE INDEX IF NOT EXISTS idx_vector_embeddings_ivfflat 
-- ON chatbot.vector_embeddings USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);
```

## 3. Package Dependencies

### Update package.json
```json
{
  "dependencies": {
    "@google/generative-ai": "^0.22.0",
    "axios": "^1.9.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "multer": "^1.4.5-lts.1",
    "node-cache": "^5.1.2",
    "pdf-parse": "^1.1.1",
    "pg": "^8.13.3",
    "pgvector": "^0.1.8",
    "socket.io": "^4.8.1",
    "socket.io-client": "^4.8.1",
    "uuid": "^11.1.0",
    "crypto": "^1.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.10.0",
    "nodemon": "^3.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  }
}
```

## 4. Environment Variables Update

### .env file
```env
# Database Configuration
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_HOST=localhost
DB_NAME=chatbot
DB_PORT=5432
DB_POOL_SIZE=20

# Vector Configuration
VECTOR_DIMENSION=768
EMBEDDING_MODEL=embedding-001

# API Keys
GEMINI_API_KEY=your_gemini_api_key

# Application
PORT=3000
FRONTEND_URL=http://localhost:5173
```

## 5. Database Migration Script

### migration.sql
```sql
-- Migration script untuk upgrade ke pgvector
-- Run this script to upgrade existing database

BEGIN;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create PDF documents table
CREATE TABLE IF NOT EXISTS chatbot.pdf_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    page_count INTEGER,
    content_hash VARCHAR(64),
    upload_status VARCHAR(20) DEFAULT 'completed' CHECK (upload_status IN ('processing', 'completed', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create PDF chunks table
CREATE TABLE IF NOT EXISTS chatbot.pdf_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_length INTEGER NOT NULL,
    page_number INTEGER,
    section_title VARCHAR(255),
    chunk_type VARCHAR(50) DEFAULT 'text',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create vector embeddings table with pgvector
CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
    document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
    embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
    embedding_vector vector(768),
    vector_dimension INTEGER NOT NULL DEFAULT 768,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_pdf_documents_hash ON chatbot.pdf_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_status ON chatbot.pdf_documents(upload_status);

CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document_id ON chatbot.pdf_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_index ON chatbot.pdf_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_content_fts ON chatbot.pdf_chunks USING gin(to_tsvector('indonesian', content));

CREATE INDEX IF NOT EXISTS idx_vector_embeddings_chunk_id ON chatbot.vector_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_document_id ON chatbot.vector_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_model ON chatbot.vector_embeddings(embedding_model);

-- Vector similarity index (HNSW)
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops);

COMMIT;
```

## 6. Installation Commands

### Install pgvector package
```bash
# Install pgvector Node.js package
npm install pgvector

# Install additional type definitions
npm install --save-dev @types/pg
```

### Run migration
```bash
# Run migration script
psql -U your_db_user -d chatbot -f migration.sql

# Verify tables created
psql -U your_db_user -d chatbot -c "\dt chatbot.*"
```

## 7. Benefits of pgvector Implementation

### Performance Benefits:
- **Persistent Storage**: Vector embeddings tidak hilang saat restart
- **Fast Similarity Search**: HNSW index untuk pencarian vector yang cepat
- **Reduced API Calls**: Tidak perlu re-generate embeddings setiap restart
- **Memory Efficiency**: Vector disimpan di disk, bukan memory

### Scalability Benefits:
- **Horizontal Scaling**: Multiple app instances dapat share vector data
- **Backup & Recovery**: Vector data ter-backup bersama database
- **Concurrent Access**: Multiple processes dapat akses vector secara bersamaan

### Cost Benefits:
- **Reduced API Costs**: Tidak perlu bayar ulang untuk generate embeddings
- **Lower Memory Usage**: Aplikasi menggunakan memory lebih sedikit
- **Faster Startup**: Aplikasi start lebih cepat karena tidak perlu re-index

Selanjutnya saya akan membuat implementasi kode untuk VectorStoreService yang menggunakan pgvector.
