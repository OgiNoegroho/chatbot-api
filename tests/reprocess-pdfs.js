require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Script to force reprocessing of existing PDFs with improved chunking
async function reprocessPDFs() {
  try {
    console.log('=== Reprocessing PDFs with Improved Chunking ===');
    
    // Import the services
    const { PDFService } = require('./dist/services/pdf.js');
    const { VectorStoreService } = require('./dist/services/vector-store.js');
    
    console.log('Initializing services...');
    const pdfService = new PDFService();
    const vectorStore = new VectorStoreService();
    
    // Get all existing documents
    const documents = pdfService.getAllDocuments();
    console.log(`Found ${documents.length} existing documents`);
    
    if (documents.length === 0) {
      console.log('No documents found. Make sure PDFs are uploaded first.');
      return;
    }
    
    // Clear vector store
    console.log('Clearing vector store...');
    vectorStore.clearAll();
    
    // Reprocess each document
    for (const doc of documents) {
      console.log(`\nReprocessing: ${doc.name}`);
      console.log(`  Original chunks: ${doc.chunks.length}`);
      
      try {
        // Reprocess the PDF with new chunking logic
        await pdfService.processPDF(doc.path, doc.id, doc.name);
        
        // Get the new chunks
        const newChunks = pdfService.getDocumentChunks(doc.id);
        console.log(`  New chunks: ${newChunks.length}`);
        
        // Add chunks to vector store
        await vectorStore.addChunks(newChunks);
        console.log(`  ✅ Added ${newChunks.length} chunks to vector store`);
        
        // Show some chunk previews
        console.log('  Chunk previews:');
        newChunks.slice(0, 3).forEach((chunk, index) => {
          const preview = chunk.content.substring(0, 80).replace(/\n/g, ' ');
          console.log(`    ${index + 1}. ${preview}...`);
        });
        
      } catch (error) {
        console.error(`  ❌ Error reprocessing ${doc.name}:`, error.message);
      }
    }
    
    console.log('\n=== Testing Search After Reprocessing ===');
    
    // Test the search functionality
    const testQuery = "apa tugas pokok dan fungsi dpmptsp";
    console.log(`Testing query: "${testQuery}"`);
    
    // Test vector search
    const vectorResults = await vectorStore.search(testQuery, 5);
    console.log(`Vector search results: ${vectorResults.length}`);
    
    vectorResults.forEach((result, index) => {
      console.log(`  ${index + 1}. Score: ${result.score.toFixed(4)} - ${result.chunk.content.substring(0, 100)}...`);
    });
    
    // Test text search
    const textResults = pdfService.searchInDocuments(testQuery);
    console.log(`\nText search results: ${textResults.chunks.length}`);
    
    textResults.chunks.slice(0, 3).forEach((chunk, index) => {
      console.log(`  ${index + 1}. ${chunk.content.substring(0, 100)}...`);
    });
    
    console.log('\n✅ Reprocessing complete! Your chatbot should now work properly.');
    
  } catch (error) {
    console.error('Error in reprocessing:', error);
    console.log('\n💡 If you see import errors, make sure to:');
    console.log('   1. Run "npm run build" first');
    console.log('   2. Then run this script');
  }
}

reprocessPDFs();
