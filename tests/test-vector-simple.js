require("dotenv").config();
const { ChatService } = require("../dist/services/chat");
const { PDFService } = require("../dist/services/pdf");

// Simple vector search test
async function testVectorSearchSimple() {
  try {
    console.log("=== SIMPLE VECTOR SEARCH TEST ===\n");

    // Initialize services
    console.log("1. Initializing services...");
    const chatService = new ChatService();
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

    console.log("4. Testing vector search...");
    const testQuery = "tugas dpmptsp";
    console.log(`Searching for: "${testQuery}"`);

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
  } catch (error) {
    console.error("❌ Error in test:", error);
    console.error("Stack:", error.stack);
  }
}

testVectorSearchSimple();
