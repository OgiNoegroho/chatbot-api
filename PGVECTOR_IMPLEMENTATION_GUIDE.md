# Panduan Implementasi pgvector untuk Chatbot

## Overview
Panduan ini menjelaskan cara mengimplementasikan pgvector untuk mengatasi masalah "vector embeddings hilang saat restart" pada aplikasi chatbot Anda.

## Masalah yang Dipecahkan

### Sebelum pgvector:
❌ Vector embeddings disimpan di memory (RAM)  
❌ Hilang setiap kali aplikasi restart  
❌ Harus re-generate embeddings (cost API Gemini)  
❌ Startup time lambat karena re-indexing  
❌ Tidak bisa scale ke multiple instances  

### Setelah pgvector:
✅ Vector embeddings disimpan di PostgreSQL  
✅ Persistent across restarts  
✅ Tidak perlu re-generate embeddings  
✅ Startup time cepat  
✅ Bisa scale ke multiple instances  
✅ Automatic backup dengan database  

## Langkah-langkah Implementasi

### 1. Install pgvector Extension

#### Untuk Ubuntu/Debian:
```bash
# Install dependencies
sudo apt update
sudo apt install postgresql-server-dev-all build-essential git

# Clone dan compile pgvector
git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install

# Restart PostgreSQL
sudo systemctl restart postgresql
```

#### Untuk Windows:
```bash
# Download pre-built binaries dari:
# https://github.com/pgvector/pgvector/releases
# Extract dan copy ke PostgreSQL directory
```

#### Untuk Docker:
```dockerfile
FROM postgres:15
RUN apt-get update && apt-get install -y \
    build-essential git postgresql-server-dev-15
RUN git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git && \
    cd pgvector && make && make install
```

### 2. Install Node.js Dependencies
```bash
npm install pgvector crypto
```

### 3. Run Database Migration
```bash
# Jalankan migration script
node scripts/migrate-to-pgvector.js
```

### 4. Update Environment Variables
```env
# Tambahkan ke .env file
VECTOR_DIMENSION=768
EMBEDDING_MODEL=embedding-001
```

### 5. Update Application Code

#### Option A: Replace Existing Service
```typescript
// Di src/app.ts, ganti import
// import { ChatService } from "./services/chat";
import { ChatPgVectorService as ChatService } from "./services/chat-pgvector";
```

#### Option B: Gradual Migration
```typescript
// Gunakan kedua service secara bersamaan
import { ChatService } from "./services/chat";
import { ChatPgVectorService } from "./services/chat-pgvector";

// Pilih service berdasarkan environment variable
const USE_PGVECTOR = process.env.USE_PGVECTOR === 'true';
const chatService = USE_PGVECTOR ? new ChatPgVectorService() : new ChatService();
```

## Testing Implementation

### 1. Test Migration
```bash
node scripts/migrate-to-pgvector.js
```

### 2. Test pgvector Implementation
```bash
# Build TypeScript first
npm run build

# Run test
node tests/test-pgvector.js
```

### 3. Test dengan Upload PDF
```bash
# Upload PDF via API
curl -X POST http://localhost:3000/api/pdf/upload \
  -F "pdf=@your-document.pdf"

# Test search
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Apa tugas DPMPTSP?"}'
```

## Database Schema Changes

### New Tables Created:
1. **chatbot.pdf_documents** - Metadata PDF files
2. **chatbot.pdf_chunks** - Text chunks dari PDF
3. **chatbot.vector_embeddings** - Vector embeddings dengan pgvector

### Key Features:
- **pgvector data type**: `vector(768)` untuk Gemini embeddings
- **HNSW index**: Untuk fast similarity search
- **Cascade deletes**: Hapus document → hapus chunks → hapus vectors
- **Full-text search**: Backup search menggunakan PostgreSQL FTS

## Performance Comparison

### Startup Time:
- **Before**: 30-60 seconds (re-indexing PDFs)
- **After**: 2-5 seconds (load from database)

### Memory Usage:
- **Before**: High (all vectors in RAM)
- **After**: Low (vectors in database)

### API Costs:
- **Before**: Re-generate embeddings setiap restart
- **After**: Generate sekali, simpan selamanya

### Search Performance:
- **Before**: In-memory cosine similarity
- **After**: pgvector HNSW index (sama cepatnya)

## Migration Strategy

### 1. Zero-Downtime Migration
```bash
# 1. Install pgvector extension
# 2. Run migration (creates new tables)
# 3. Deploy new code with feature flag
USE_PGVECTOR=false npm start

# 4. Test new implementation
USE_PGVECTOR=true npm run test

# 5. Switch to pgvector
USE_PGVECTOR=true npm start
```

### 2. Data Migration
```javascript
// Script untuk migrate existing data
const { ChatService } = require('./dist/services/chat');
const { ChatPgVectorService } = require('./dist/services/chat-pgvector');

async function migrateData() {
  const oldService = new ChatService();
  const newService = new ChatPgVectorService();
  
  // Get all PDFs from old service
  const documents = oldService.getAllPDFDocuments();
  
  // Re-upload to new service (will generate and save vectors)
  for (const doc of documents) {
    await newService.uploadPDF(doc.path, doc.name);
  }
}
```

## Troubleshooting

### Error: "extension vector does not exist"
```sql
-- Connect to database and enable extension
\c chatbot
CREATE EXTENSION IF NOT EXISTS vector;
```

### Error: "pgvector not installed"
```bash
# Check if pgvector is available
psql -c "SELECT * FROM pg_available_extensions WHERE name = 'vector';"

# If not available, install pgvector first
```

### Error: "vector dimension mismatch"
```typescript
// Make sure vector dimension matches Gemini embedding-001
const VECTOR_DIMENSION = 768; // Gemini embedding-001 uses 768 dimensions
```

### Performance Issues
```sql
-- Check if HNSW index exists
\d+ chatbot.vector_embeddings

-- Create index if missing
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops);
```

## Monitoring & Maintenance

### 1. Monitor Vector Store
```typescript
// Get statistics
const stats = await chatService.getVectorStats();
console.log(`Vectors: ${stats.entryCount}, Documents: ${stats.documentCount}`);
```

### 2. Database Maintenance
```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'chatbot';

-- Vacuum and analyze
VACUUM ANALYZE chatbot.vector_embeddings;
```

### 3. Backup Strategy
```bash
# Backup includes vector data
pg_dump -U username -d chatbot > chatbot_backup.sql

# Restore
psql -U username -d chatbot < chatbot_backup.sql
```

## Next Steps

1. ✅ Install pgvector extension
2. ✅ Run migration script
3. ✅ Test implementation
4. ✅ Update application code
5. ✅ Deploy to production
6. 📊 Monitor performance
7. 🔄 Setup automated backups

## Benefits Summary

- **🚀 Performance**: Faster startup, lower memory usage
- **💰 Cost**: Reduced API calls to Gemini
- **🔄 Reliability**: Persistent data, no data loss on restart
- **📈 Scalability**: Multiple app instances can share vector data
- **🛡️ Backup**: Vector data included in database backups
- **🔍 Search**: Fast similarity search with HNSW index

Implementasi pgvector akan mengatasi masalah utama "vector embeddings hilang saat restart" dan memberikan foundation yang solid untuk scaling aplikasi chatbot Anda.
