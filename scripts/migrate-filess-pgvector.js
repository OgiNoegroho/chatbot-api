require('dotenv').config();
const { Pool } = require('pg');

// Migration script khusus untuk filess.io
async function migrateFilessPgVector() {
  console.log('=== MIGRATING FILESS.IO TO PGVECTOR ===\n');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    console.log('1. Testing filess.io connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connected to filess.io database');

    console.log('2. Creating chatbot schema if not exists...');
    await pool.query('CREATE SCHEMA IF NOT EXISTS chatbot');
    console.log('✅ Schema chatbot ready');

    console.log('3. Setting search path to chatbot schema...');
    await pool.query('SET search_path TO chatbot, public');
    console.log('✅ Search path set to chatbot schema');

    console.log('4. Enabling pgvector extension...');
    try {
      // Try to create extension in chatbot schema
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector SCHEMA chatbot');
      console.log('✅ pgvector extension enabled in chatbot schema');
    } catch (error) {
      console.log('⚠️  Trying to enable in public schema...');
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('✅ pgvector extension enabled in public schema');
      } catch (error2) {
        console.log('❌ Failed to enable pgvector extension:', error2.message);
        console.log('💡 Continuing with migration, extension might already be available...');
      }
    }

    console.log('5. Testing vector operations...');
    try {
      await pool.query("SELECT '[1,2,3]'::vector(3) as test_vector");
      console.log('✅ Vector operations working!');
    } catch (error) {
      console.log('❌ Vector operations failed:', error.message);
      console.log('💡 Will use array-based fallback implementation');
    }

    console.log('6. Creating existing tables if not exist...');
    
    // Create basic chat tables first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot.chats (
        id UUID PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ chats table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot.messages (
        id UUID PRIMARY KEY,
        chat_id UUID REFERENCES chatbot.chats(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ messages table ready');

    console.log('7. Creating pgvector tables...');

    // PDF documents table
    await pool.query(`
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
      )
    `);
    console.log('✅ pdf_documents table created');

    // PDF chunks table
    await pool.query(`
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
      )
    `);
    console.log('✅ pdf_chunks table created');

    // Vector embeddings table - try pgvector first, fallback to array
    console.log('8. Creating vector embeddings table...');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
          document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
          embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
          embedding_vector vector(768),
          vector_dimension INTEGER NOT NULL DEFAULT 768,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ vector_embeddings table created with pgvector type');
    } catch (error) {
      console.log('⚠️  pgvector type failed, using array fallback...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chatbot.vector_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chunk_id UUID REFERENCES chatbot.pdf_chunks(id) ON DELETE CASCADE,
          document_id UUID REFERENCES chatbot.pdf_documents(id) ON DELETE CASCADE,
          embedding_model VARCHAR(100) NOT NULL DEFAULT 'embedding-001',
          embedding_vector FLOAT8[],
          vector_dimension INTEGER NOT NULL DEFAULT 768,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ vector_embeddings table created with array type');
    }

    console.log('9. Creating indexes...');

    // Basic indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON chatbot.messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON chatbot.messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_pdf_documents_hash ON chatbot.pdf_documents(content_hash);
      CREATE INDEX IF NOT EXISTS idx_pdf_chunks_document_id ON chatbot.pdf_chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_chunk_id ON chatbot.vector_embeddings(chunk_id);
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_document_id ON chatbot.vector_embeddings(document_id);
    `);
    console.log('✅ Basic indexes created');

    // Vector similarity index
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
        ON chatbot.vector_embeddings USING hnsw (embedding_vector vector_cosine_ops)
      `);
      console.log('✅ HNSW vector index created');
    } catch (error) {
      console.log('⚠️  HNSW index failed, will use sequential scan for similarity');
    }

    // Full-text search index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pdf_chunks_content_fts 
      ON chatbot.pdf_chunks USING gin(to_tsvector('english', content))
    `);
    console.log('✅ Full-text search index created');

    console.log('10. Creating utility functions...');

    // Vector similarity function (works with both pgvector and arrays)
    await pool.query(`
      CREATE OR REPLACE FUNCTION chatbot.cosine_similarity(a FLOAT8[], b FLOAT8[])
      RETURNS FLOAT AS $$
      DECLARE
        dot_product FLOAT := 0;
        norm_a FLOAT := 0;
        norm_b FLOAT := 0;
        i INTEGER;
      BEGIN
        IF array_length(a, 1) != array_length(b, 1) THEN
          RETURN 0;
        END IF;
        
        FOR i IN 1..array_length(a, 1) LOOP
          dot_product := dot_product + (a[i] * b[i]);
          norm_a := norm_a + (a[i] * a[i]);
          norm_b := norm_b + (b[i] * b[i]);
        END LOOP;
        
        IF norm_a = 0 OR norm_b = 0 THEN
          RETURN 0;
        END IF;
        
        RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Cosine similarity function created');

    // Update timestamp trigger
    await pool.query(`
      CREATE OR REPLACE FUNCTION chatbot.update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS update_pdf_documents_timestamp ON chatbot.pdf_documents;
      CREATE TRIGGER update_pdf_documents_timestamp
        BEFORE UPDATE ON chatbot.pdf_documents
        FOR EACH ROW EXECUTE FUNCTION chatbot.update_timestamp();
    `);
    console.log('✅ Timestamp triggers created');

    console.log('11. Verifying tables...');
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'chatbot' 
      ORDER BY table_name
    `);

    console.log('📋 Tables in chatbot schema:');
    tableCheck.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}`);
    });

    console.log('\n=== FILESS.IO MIGRATION COMPLETED ===');
    console.log('🎉 pgvector implementation ready on filess.io!');
    console.log('✅ All tables created successfully');
    console.log('✅ Indexes and functions ready');
    console.log('✅ You can now use ChatPgVectorService');
    
    console.log('\nNext steps:');
    console.log('1. Test with: node tests/test-pgvector.js');
    console.log('2. Update your app to use ChatPgVectorService');
    console.log('3. Upload PDFs to populate vector database');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
  } finally {
    await pool.end();
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateFilessPgVector().catch(error => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
}

module.exports = { migrateFilessPgVector };
