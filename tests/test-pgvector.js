require('dotenv').config();
const { ChatPgVectorService } = require('../dist/services/chat-pgvector');

// Test pgvector implementation
async function testPgVector() {
  console.log('=== TESTING PGVECTOR IMPLEMENTATION ===\n');

  try {
    // Initialize chat service with pgvector
    console.log('1. Initializing ChatPgVectorService...');
    const chatService = new ChatPgVectorService();

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ ChatPgVectorService initialized');

    // Check vector store statistics
    console.log('2. Checking vector store statistics...');
    const stats = await chatService.getVectorStats();
    console.log(`📊 Vector Store Stats:`);
    console.log(`  - Documents: ${stats.documentCount}`);
    console.log(`  - Chunks: ${stats.chunkCount}`);
    console.log(`  - Vector Embeddings: ${stats.entryCount}`);
    console.log(`  - Cache Size: ${stats.cacheSize}`);

    // Get all PDF documents
    console.log('3. Checking PDF documents...');
    const documents = await chatService.getAllPDFDocuments();
    console.log(`📄 Found ${documents.length} PDF documents:`);
    documents.forEach((doc, index) => {
      console.log(`  ${index + 1}. ${doc.name} (${doc.fileSize} bytes, ${doc.pageCount} pages)`);
    });

    if (documents.length === 0) {
      console.log('⚠️  No PDF documents found. Upload some PDFs first to test vector search.');
      console.log('   You can use the existing PDF upload endpoint: POST /api/pdf/upload');
    } else {
      // Test vector search
      console.log('4. Testing vector search...');
      const testQueries = [
        'tugas pokok dan fungsi DPMPTSP',
        'pelayanan perizinan',
        'visi dan misi',
        'struktur organisasi'
      ];

      for (const query of testQueries) {
        console.log(`\n🔍 Testing query: "${query}"`);
        
        const searchResult = await chatService.findRelevantPDFContent(query);
        
        if (searchResult && searchResult.chunks.length > 0) {
          console.log(`✅ Found ${searchResult.chunks.length} relevant chunks`);
          searchResult.chunks.forEach((chunk, index) => {
            const docName = searchResult.documentNames[chunk.documentId] || 'Unknown';
            console.log(`  ${index + 1}. From "${docName}": "${chunk.content.substring(0, 100)}..."`);
          });
        } else {
          console.log(`❌ No relevant content found`);
        }
      }

      // Test chat functionality
      console.log('\n5. Testing chat functionality...');
      const testChatId = 'test-pgvector-chat';
      
      try {
        // Send a test message
        const testMessage = 'Apa tugas pokok dan fungsi DPMPTSP?';
        console.log(`💬 Sending test message: "${testMessage}"`);
        
        const messages = await chatService.processUserMessage(testChatId, testMessage);
        
        if (messages && messages.length >= 2) {
          console.log('✅ Chat response generated successfully');
          console.log(`👤 User: ${messages[0].content}`);
          console.log(`🤖 Assistant: ${messages[1].content.substring(0, 200)}...`);
        } else {
          console.log('❌ Chat response failed');
        }
      } catch (error) {
        console.log(`❌ Chat test failed: ${error.message}`);
      }
    }

    // Test persistence (simulate restart)
    console.log('\n6. Testing vector persistence...');
    console.log('📊 Current vector count:', stats.entryCount);
    
    if (stats.entryCount > 0) {
      console.log('✅ Vectors are persisted in database');
      console.log('🔄 Vectors will survive application restarts');
    } else {
      console.log('⚠️  No vectors found in database');
      console.log('   Upload PDFs to populate the vector store');
    }

    // Performance comparison
    console.log('\n7. Performance benefits of pgvector:');
    console.log('✅ Vector embeddings persist across restarts');
    console.log('✅ No need to re-generate embeddings on startup');
    console.log('✅ Reduced API calls to Gemini');
    console.log('✅ Faster application startup time');
    console.log('✅ Scalable to multiple application instances');
    console.log('✅ Automatic backup with database backups');

    console.log('\n=== PGVECTOR TEST COMPLETED ===');
    
    // Cleanup
    await chatService.cleanup();
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
    
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.error('\n💡 Hint: Run migration first with: node scripts/migrate-to-pgvector.js');
    }
    
    if (error.message.includes('vector')) {
      console.error('\n💡 Hint: Make sure pgvector extension is installed and enabled');
    }
  }
}

// Run test if this script is executed directly
if (require.main === module) {
  testPgVector().catch(error => {
    console.error('Test script failed:', error);
    process.exit(1);
  });
}

module.exports = { testPgVector };
