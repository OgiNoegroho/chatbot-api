require("dotenv").config();
const { ChatService } = require("../dist/services/chat");
const { VectorStoreService } = require("../dist/services/vector-store");
const { PDFService } = require("../dist/services/pdf");

// Simple vector search test
async function testVectorSearchSimple() {
  try {
    console.log("=== SIMPLE VECTOR SEARCH TEST ===\n");

    // Initialize services
    console.log("1. Initializing services...");
    const chatService = new ChatService();
    const vectorStore = new VectorStoreService();
    const pdfService = new PDFService();

    console.log("2. Checking PDF documents...");
    const allDocs = pdfService.getAllDocuments();
    console.log(`Found ${allDocs.length} PDF documents`);

    if (allDocs.length === 0) {
      console.log("❌ No PDFs found!");
      return;
    }

    // Show first document info
    const firstDoc = allDocs[0];
    console.log(
      `First document: ${firstDoc.name} with ${firstDoc.chunks.length} chunks`
    );

    console.log("3. Checking vector store...");
    const stats = vectorStore.getStats();
    console.log(`Vector store has ${stats.entryCount} entries`);

    if (stats.entryCount === 0) {
      console.log("Vector store is empty, indexing first document...");
      await vectorStore.addChunks(firstDoc.chunks.slice(0, 5)); // Just first 5 chunks for testing
      const newStats = vectorStore.getStats();
      console.log(`Indexed ${newStats.entryCount} chunks`);
    }

    console.log("4. Testing vector search...");
    const testQuery = "tugas dpmptsp";
    console.log(`Searching for: "${testQuery}"`);

    const results = await vectorStore.search(testQuery, 3);
    console.log(`Found ${results.length} results:`);

    results.forEach((result, index) => {
      console.log(`  ${index + 1}. Score: ${result.score.toFixed(4)}`);
      console.log(
        `     Content: "${result.chunk.content.substring(0, 100)}..."`
      );
    });

    console.log("5. Testing chat service PDF search...");
    const pdfContent = await chatService.findRelevantPDFContent(testQuery);

    if (pdfContent && pdfContent.chunks.length > 0) {
      console.log(
        `✅ Chat service found ${pdfContent.chunks.length} relevant chunks`
      );
      console.log(
        `First chunk: "${pdfContent.chunks[0].content.substring(0, 100)}..."`
      );
    } else {
      console.log(`❌ Chat service found no relevant content`);
    }

    console.log("\n=== TEST COMPLETE ===");
    console.log(
      `✅ Vector search is ${stats.entryCount > 0 ? "WORKING" : "NOT WORKING"}`
    );
  } catch (error) {
    console.error("❌ Error in test:", error);
    console.error("Stack:", error.stack);
  }
}

testVectorSearchSimple();
