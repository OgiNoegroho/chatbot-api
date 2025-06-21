require('dotenv').config();
const { Pool } = require('pg');

// Script untuk mengecek apakah embeddings tersimpan dengan baik di database
async function checkEmbeddingStorage() {
  console.log('=== CHECKING EMBEDDING STORAGE IN DATABASE ===\n');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    console.log('1. Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Check if tables exist
    console.log('\n2. Checking required tables...');
    const tablesCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'chatbot' 
      AND table_name IN ('pdf_documents', 'pdf_chunks', 'vector_embeddings')
      ORDER BY table_name
    `);

    const existingTables = tablesCheck.rows.map(row => row.table_name);
    console.log('📋 Available tables:', existingTables);

    if (existingTables.length < 3) {
      console.log('❌ Missing required tables. Run migration first.');
      return;
    }

    // Check PDF documents
    console.log('\n3. Checking PDF documents...');
    const documentsResult = await pool.query(`
      SELECT id, original_name, file_size, page_count, upload_status, created_at
      FROM chatbot.pdf_documents 
      ORDER BY created_at DESC
    `);

    console.log(`📄 Found ${documentsResult.rows.length} PDF documents:`);
    if (documentsResult.rows.length === 0) {
      console.log('⚠️  No PDF documents found. Upload a PDF first to test embeddings.');
      console.log('   Use: POST /api/pdf/upload');
    } else {
      documentsResult.rows.forEach((doc, index) => {
        console.log(`  ${index + 1}. ${doc.original_name} (${doc.file_size} bytes, ${doc.page_count} pages)`);
        console.log(`     Status: ${doc.upload_status}, Created: ${doc.created_at}`);
      });
    }

    // Check PDF chunks
    console.log('\n4. Checking PDF chunks...');
    const chunksResult = await pool.query(`
      SELECT 
        c.document_id,
        d.original_name,
        COUNT(c.id) as chunk_count,
        AVG(c.content_length) as avg_chunk_length,
        MIN(c.content_length) as min_chunk_length,
        MAX(c.content_length) as max_chunk_length
      FROM chatbot.pdf_chunks c
      JOIN chatbot.pdf_documents d ON c.document_id = d.id
      GROUP BY c.document_id, d.original_name
      ORDER BY d.created_at DESC
    `);

    console.log(`📝 Found chunks for ${chunksResult.rows.length} documents:`);
    chunksResult.rows.forEach((chunk, index) => {
      console.log(`  ${index + 1}. ${chunk.original_name}: ${chunk.chunk_count} chunks`);
      console.log(`     Avg length: ${Math.round(chunk.avg_chunk_length)} chars (${chunk.min_chunk_length}-${chunk.max_chunk_length})`);
    });

    // Check vector embeddings - MOST IMPORTANT
    console.log('\n5. Checking vector embeddings (CRITICAL)...');
    const embeddingsResult = await pool.query(`
      SELECT 
        v.document_id,
        d.original_name,
        COUNT(v.id) as embedding_count,
        v.embedding_model,
        v.vector_dimension,
        array_length(v.embedding_vector, 1) as actual_vector_length
      FROM chatbot.vector_embeddings v
      JOIN chatbot.pdf_documents d ON v.document_id = d.id
      GROUP BY v.document_id, d.original_name, v.embedding_model, v.vector_dimension, v.embedding_vector
      ORDER BY d.created_at DESC
    `);

    console.log(`🧮 Found embeddings for ${embeddingsResult.rows.length} documents:`);
    if (embeddingsResult.rows.length === 0) {
      console.log('❌ NO VECTOR EMBEDDINGS FOUND!');
      console.log('   This means embeddings are NOT being stored properly.');
      console.log('   Possible issues:');
      console.log('   1. PDF upload process failed');
      console.log('   2. Gemini API key not working');
      console.log('   3. Vector storage function has errors');
    } else {
      embeddingsResult.rows.forEach((emb, index) => {
        console.log(`  ${index + 1}. ${emb.original_name}: ${emb.embedding_count} embeddings`);
        console.log(`     Model: ${emb.embedding_model}, Dimension: ${emb.vector_dimension}`);
        console.log(`     Actual vector length: ${emb.actual_vector_length}`);
        
        if (emb.actual_vector_length !== 768) {
          console.log(`     ⚠️  WARNING: Expected 768 dimensions, got ${emb.actual_vector_length}`);
        } else {
          console.log(`     ✅ Vector dimensions correct (768)`);
        }
      });
    }

    // Test vector data quality
    console.log('\n6. Testing vector data quality...');
    const vectorSampleResult = await pool.query(`
      SELECT 
        v.id,
        c.content,
        v.embedding_vector,
        array_length(v.embedding_vector, 1) as vector_length
      FROM chatbot.vector_embeddings v
      JOIN chatbot.pdf_chunks c ON v.chunk_id = c.id
      LIMIT 3
    `);

    if (vectorSampleResult.rows.length > 0) {
      console.log('📊 Sample vector data:');
      vectorSampleResult.rows.forEach((sample, index) => {
        const vector = sample.embedding_vector;
        const firstFew = vector.slice(0, 5);
        const lastFew = vector.slice(-5);
        
        console.log(`  ${index + 1}. Content: "${sample.content.substring(0, 50)}..."`);
        console.log(`     Vector length: ${sample.vector_length}`);
        console.log(`     First 5 values: [${firstFew.map(v => v.toFixed(4)).join(', ')}]`);
        console.log(`     Last 5 values: [${lastFew.map(v => v.toFixed(4)).join(', ')}]`);
        
        // Check if vector contains valid numbers
        const hasValidNumbers = vector.every(v => typeof v === 'number' && !isNaN(v));
        const hasNonZeroValues = vector.some(v => Math.abs(v) > 0.001);
        
        if (hasValidNumbers && hasNonZeroValues) {
          console.log(`     ✅ Vector data looks valid`);
        } else {
          console.log(`     ❌ Vector data looks invalid`);
        }
      });
    } else {
      console.log('❌ No vector samples found');
    }

    // Test cosine similarity function
    console.log('\n7. Testing cosine similarity function...');
    try {
      const similarityTest = await pool.query(`
        SELECT chatbot.cosine_similarity(
          ARRAY[1.0, 0.0, 0.0]::FLOAT8[], 
          ARRAY[1.0, 0.0, 0.0]::FLOAT8[]
        ) as similarity_identical,
        chatbot.cosine_similarity(
          ARRAY[1.0, 0.0, 0.0]::FLOAT8[], 
          ARRAY[0.0, 1.0, 0.0]::FLOAT8[]
        ) as similarity_orthogonal
      `);
      
      const identical = similarityTest.rows[0].similarity_identical;
      const orthogonal = similarityTest.rows[0].similarity_orthogonal;
      
      console.log(`🧮 Cosine similarity test:`);
      console.log(`   Identical vectors: ${identical} (should be ~1.0)`);
      console.log(`   Orthogonal vectors: ${orthogonal} (should be ~0.0)`);
      
      if (Math.abs(identical - 1.0) < 0.001 && Math.abs(orthogonal - 0.0) < 0.001) {
        console.log('✅ Cosine similarity function working correctly');
      } else {
        console.log('❌ Cosine similarity function has issues');
      }
    } catch (error) {
      console.log(`❌ Cosine similarity function failed: ${error.message}`);
    }

    // Test actual vector search if embeddings exist
    if (embeddingsResult.rows.length > 0) {
      console.log('\n8. Testing vector search...');
      try {
        const searchTest = await pool.query(`
          SELECT 
            c.content,
            chatbot.cosine_similarity($1::FLOAT8[], v.embedding_vector) as similarity
          FROM chatbot.vector_embeddings v
          JOIN chatbot.pdf_chunks c ON v.chunk_id = c.id
          WHERE chatbot.cosine_similarity($1::FLOAT8[], v.embedding_vector) > 0
          ORDER BY similarity DESC
          LIMIT 3
        `, [embeddingsResult.rows[0].embedding_vector || Array(768).fill(0.1)]);

        console.log(`🔍 Vector search test found ${searchTest.rows.length} results:`);
        searchTest.rows.forEach((result, index) => {
          console.log(`  ${index + 1}. Similarity: ${result.similarity.toFixed(4)}`);
          console.log(`     Content: "${result.content.substring(0, 80)}..."`);
        });

        if (searchTest.rows.length > 0) {
          console.log('✅ Vector search working');
        } else {
          console.log('❌ Vector search not returning results');
        }
      } catch (error) {
        console.log(`❌ Vector search test failed: ${error.message}`);
      }
    }

    // Summary
    console.log('\n=== EMBEDDING STORAGE SUMMARY ===');
    const totalDocuments = documentsResult.rows.length;
    const totalChunks = chunksResult.rows.reduce((sum, row) => sum + parseInt(row.chunk_count), 0);
    const totalEmbeddings = embeddingsResult.rows.reduce((sum, row) => sum + parseInt(row.embedding_count), 0);

    console.log(`📊 Statistics:`);
    console.log(`   Documents: ${totalDocuments}`);
    console.log(`   Chunks: ${totalChunks}`);
    console.log(`   Embeddings: ${totalEmbeddings}`);

    if (totalDocuments > 0 && totalChunks > 0 && totalEmbeddings > 0) {
      console.log('🎉 EMBEDDINGS ARE STORED SUCCESSFULLY!');
      console.log('✅ PDF upload → chunks → embeddings pipeline working');
      console.log('✅ Vector search ready for use');
    } else if (totalDocuments > 0 && totalChunks > 0 && totalEmbeddings === 0) {
      console.log('⚠️  EMBEDDINGS NOT GENERATED!');
      console.log('❌ PDFs uploaded and chunked, but no embeddings created');
      console.log('💡 Check Gemini API key and embedding generation process');
    } else if (totalDocuments === 0) {
      console.log('ℹ️  NO DATA TO CHECK');
      console.log('📤 Upload a PDF first to test the embedding pipeline');
    } else {
      console.log('❌ PARTIAL FAILURE');
      console.log('🔧 Some part of the pipeline is not working correctly');
    }

  } catch (error) {
    console.error('❌ Error checking embedding storage:', error.message);
    console.error('Error details:', error);
  } finally {
    await pool.end();
  }
}

// Run check if this script is executed directly
if (require.main === module) {
  checkEmbeddingStorage().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = { checkEmbeddingStorage };
