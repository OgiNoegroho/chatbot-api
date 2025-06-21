-- Migration script untuk upgrade ke pgvector
-- Run this script to upgrade existing database to support vector embeddings

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
    content_hash VARCHAR(64), -- SHA-256 hash for duplicate detection
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
    embedding_vector vector(768), -- Gemini embedding-001 uses 768 dimensions
    vector_dimension INTEGER NOT NULL DEFAULT 768,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for PDF documents
CREATE INDEX IF NOT EXISTS idx_pdf_documents_hash ON chatbot.pdf_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_status ON chatbot.pdf_documents(upload_status);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_created_at ON chatbot.pdf_documents(created_at);

-- Create indexes for PDF chunks
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document_id ON chatbot.pdf_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_index ON chatbot.pdf_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_type ON chatbot.pdf_chunks(chunk_type);

-- Full-text search index for Indonesian content
CREATE INDEX IF NOT EXISTS idx_pdf_chunks_content_fts 
ON chatbot.pdf_chunks USING gin(to_tsvector('indonesian', content));

-- Create indexes for vector embeddings
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_chunk_id ON chatbot.vector_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_document_id ON chatbot.vector_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_model ON chatbot.vector_embeddings(embedding_model);

-- Vector similarity index using HNSW (Hierarchical Navigable Small World)
-- This provides the best performance for similarity search
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops);

-- Alternative: IVFFlat index (faster to build, slower to query)
-- Uncomment if you prefer faster index building over query performance
-- CREATE INDEX IF NOT EXISTS idx_vector_embeddings_ivfflat 
-- ON chatbot.vector_embeddings USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);

-- Create trigger function for updating timestamps
CREATE OR REPLACE FUNCTION chatbot.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply timestamp trigger to PDF documents
CREATE TRIGGER update_pdf_documents_timestamp
    BEFORE UPDATE ON chatbot.pdf_documents
    FOR EACH ROW EXECUTE FUNCTION chatbot.update_timestamp();

-- Create function to calculate vector similarity
CREATE OR REPLACE FUNCTION chatbot.vector_similarity(
    query_vector vector(768),
    target_vector vector(768)
) RETURNS FLOAT AS $$
BEGIN
    RETURN 1 - (query_vector <=> target_vector);
END;
$$ LANGUAGE plpgsql;

-- Create function to search similar vectors
CREATE OR REPLACE FUNCTION chatbot.search_similar_vectors(
    query_vector vector(768),
    similarity_threshold FLOAT DEFAULT 0.2,
    result_limit INTEGER DEFAULT 10,
    document_ids UUID[] DEFAULT NULL
) RETURNS TABLE(
    chunk_id UUID,
    document_id UUID,
    content TEXT,
    similarity_score FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id as chunk_id,
        c.document_id,
        c.content,
        chatbot.vector_similarity(query_vector, v.embedding_vector) as similarity_score,
        c.metadata
    FROM chatbot.vector_embeddings v
    JOIN chatbot.pdf_chunks c ON v.chunk_id = c.id
    WHERE 
        (document_ids IS NULL OR c.document_id = ANY(document_ids))
        AND chatbot.vector_similarity(query_vector, v.embedding_vector) >= similarity_threshold
    ORDER BY v.embedding_vector <=> query_vector
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create view for document statistics
CREATE OR REPLACE VIEW chatbot.document_stats AS
SELECT 
    d.id,
    d.original_name,
    d.file_size,
    d.page_count,
    d.upload_status,
    d.created_at,
    COUNT(c.id) as chunk_count,
    COUNT(v.id) as vector_count,
    AVG(c.content_length) as avg_chunk_length
FROM chatbot.pdf_documents d
LEFT JOIN chatbot.pdf_chunks c ON d.id = c.document_id
LEFT JOIN chatbot.vector_embeddings v ON c.id = v.chunk_id
GROUP BY d.id, d.original_name, d.file_size, d.page_count, d.upload_status, d.created_at;

COMMIT;

-- Display success message
DO $$
BEGIN
    RAISE NOTICE 'pgvector migration completed successfully!';
    RAISE NOTICE 'Tables created: pdf_documents, pdf_chunks, vector_embeddings';
    RAISE NOTICE 'Indexes created for optimal vector similarity search';
    RAISE NOTICE 'Functions created: vector_similarity, search_similar_vectors';
END $$;
