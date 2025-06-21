require('dotenv').config();
const { Pool } = require('pg');

// Simple script untuk mengecek status embeddings
async function simpleEmbeddingCheck() {
  console.log('=== SIMPLE EMBEDDING CHECK ===\n');

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

    // Check PDF documents
    console.log('\n2. Checking PDF documents...');
    const documentsResult = await pool.query(`
      SELECT COUNT(*) as count FROM chatbot.pdf_documents
    `);
    const docCount = parseInt(documentsResult.rows[0].count);
    console.log(`📄 PDF Documents: ${docCount}`);

    if (docCount === 0) {
      console.log('⚠️  No PDF documents found.');
      console.log('   Upload a PDF first: POST /api/pdf/upload');
      console.log('   Then run this check again.');
      return;
    }

    // Show document details
    const docDetails = await pool.query(`
      SELECT id, original_name, file_size, upload_status, created_at
      FROM chatbot.pdf_documents 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('📋 Recent documents:');
    docDetails.rows.forEach((doc, index) => {
      console.log(`  ${index + 1}. ${doc.original_name} (${doc.upload_status})`);
    });

    // Check PDF chunks
    console.log('\n3. Checking PDF chunks...');
    const chunksResult = await pool.query(`
      SELECT COUNT(*) as count FROM chatbot.pdf_chunks
    `);
    const chunkCount = parseInt(chunksResult.rows[0].count);
    console.log(`📝 PDF Chunks: ${chunkCount}`);

    // Check vector embeddings - MOST IMPORTANT
    console.log('\n4. Checking vector embeddings...');
    const embeddingsResult = await pool.query(`
      SELECT COUNT(*) as count FROM chatbot.vector_embeddings
    `);
    const embeddingCount = parseInt(embeddingsResult.rows[0].count);
    console.log(`🧮 Vector Embeddings: ${embeddingCount}`);

    if (embeddingCount === 0) {
      console.log('❌ NO EMBEDDINGS FOUND!');
      console.log('   This means the embedding generation process failed.');
      console.log('   Possible causes:');
      console.log('   1. Gemini API key not working');
      console.log('   2. Error in embedding generation code');
      console.log('   3. Database insertion failed');
    } else {
      console.log('✅ Embeddings found in database!');
    }

    // Check embedding details if they exist
    if (embeddingCount > 0) {
      console.log('\n5. Checking embedding details...');
      
      const embeddingDetails = await pool.query(`
        SELECT 
          embedding_model,
          vector_dimension,
          array_length(embedding_vector, 1) as actual_length,
          COUNT(*) as count
        FROM chatbot.vector_embeddings 
        GROUP BY embedding_model, vector_dimension, array_length(embedding_vector, 1)
      `);

      console.log('📊 Embedding details:');
      embeddingDetails.rows.forEach((detail, index) => {
        console.log(`  ${index + 1}. Model: ${detail.embedding_model}`);
        console.log(`     Expected dimension: ${detail.vector_dimension}`);
        console.log(`     Actual dimension: ${detail.actual_length}`);
        console.log(`     Count: ${detail.count} embeddings`);
        
        if (detail.actual_length === 768) {
          console.log(`     ✅ Correct vector dimension`);
        } else {
          console.log(`     ❌ Wrong vector dimension!`);
        }
      });

      // Test a sample embedding
      console.log('\n6. Testing sample embedding...');
      const sampleResult = await pool.query(`
        SELECT 
          v.id,
          c.content,
          array_length(v.embedding_vector, 1) as vector_length,
          v.embedding_vector[1:5] as first_5_values
        FROM chatbot.vector_embeddings v
        JOIN chatbot.pdf_chunks c ON v.chunk_id = c.id
        LIMIT 1
      `);

      if (sampleResult.rows.length > 0) {
        const sample = sampleResult.rows[0];
        console.log(`📋 Sample embedding:`);
        console.log(`   Content: "${sample.content.substring(0, 60)}..."`);
        console.log(`   Vector length: ${sample.vector_length}`);
        console.log(`   First 5 values: [${sample.first_5_values.join(', ')}]`);
        
        // Check if values look reasonable
        const hasReasonableValues = sample.first_5_values.every(v => 
          typeof v === 'number' && !isNaN(v) && Math.abs(v) < 10
        );
        
        if (hasReasonableValues) {
          console.log(`   ✅ Vector values look reasonable`);
        } else {
          console.log(`   ❌ Vector values look suspicious`);
        }
      }

      // Test cosine similarity function
      console.log('\n7. Testing cosine similarity...');
      try {
        const similarityTest = await pool.query(`
          SELECT chatbot.cosine_similarity(
            ARRAY[1.0, 0.0, 0.0]::FLOAT8[], 
            ARRAY[1.0, 0.0, 0.0]::FLOAT8[]
          ) as test_result
        `);
        
        const result = similarityTest.rows[0].test_result;
        console.log(`🧮 Cosine similarity test: ${result}`);
        
        if (Math.abs(result - 1.0) < 0.001) {
          console.log('✅ Cosine similarity function working');
        } else {
          console.log('❌ Cosine similarity function has issues');
        }
      } catch (error) {
        console.log(`❌ Cosine similarity test failed: ${error.message}`);
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`📊 Database Status:`);
    console.log(`   Documents: ${docCount}`);
    console.log(`   Chunks: ${chunkCount}`);
    console.log(`   Embeddings: ${embeddingCount}`);

    if (docCount > 0 && chunkCount > 0 && embeddingCount > 0) {
      console.log('\n🎉 EMBEDDINGS ARE WORKING!');
      console.log('✅ PDF → Chunks → Embeddings pipeline successful');
      console.log('✅ Vector search should work properly');
      console.log('✅ Ready for production use');
    } else if (docCount > 0 && chunkCount > 0 && embeddingCount === 0) {
      console.log('\n❌ EMBEDDINGS FAILED!');
      console.log('⚠️  PDFs uploaded and chunked, but no embeddings generated');
      console.log('🔧 Check Gemini API key and embedding generation process');
    } else if (docCount === 0) {
      console.log('\n📤 NO DATA TO TEST');
      console.log('ℹ️  Upload a PDF first to test the embedding pipeline');
      console.log('   Use: POST /api/pdf/upload');
    } else {
      console.log('\n⚠️  PARTIAL SUCCESS');
      console.log('🔧 Some part of the pipeline needs attention');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Run check
if (require.main === module) {
  simpleEmbeddingCheck().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = { simpleEmbeddingCheck };
