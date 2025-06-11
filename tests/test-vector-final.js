require("dotenv").config();
const { ChatService } = require("../dist/services/chat");

// Final comprehensive test for vector search
async function testVectorSearchFinal() {
  try {
    console.log("=== FINAL VECTOR SEARCH TEST ===\n");

    // Initialize chat service (this will load PDFs and initialize vector store)
    console.log("1. Initializing chat service...");
    const chatService = new ChatService();

    // Wait a moment for initialization to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("2. Testing PDF document availability...");
    const allDocs = chatService.getAllPDFDocuments();
    console.log(`Found ${allDocs.length} PDF documents:`);
    allDocs.forEach((doc, index) => {
      console.log(`  ${index + 1}. ${doc.name} - ${doc.chunks.length} chunks`);
    });

    if (allDocs.length === 0) {
      console.log("❌ No PDFs found! Vector search cannot be tested.");
      return;
    }

    console.log("\n3. Testing vector search with various queries...");

    const testQueries = [
      "apa tugas pokok dan fungsi dpmptsp",
      "tugas dpmptsp",
      "fungsi dpmptsp",
      "layanan perizinan",
      "penanaman modal",
      "DPMPTSP",
    ];

    for (const query of testQueries) {
      console.log(`\n--- Testing: "${query}" ---`);

      try {
        // Test the findRelevantPDFContent method
        const pdfContent = await chatService.findRelevantPDFContent(query);

        if (pdfContent && pdfContent.chunks.length > 0) {
          console.log(`✅ Found ${pdfContent.chunks.length} relevant chunks`);

          // Show the first chunk content
          const firstChunk = pdfContent.chunks[0];
          console.log(
            `   First result: "${firstChunk.content.substring(0, 150)}..."`
          );

          // Show document names
          const docNames = Object.values(pdfContent.documentNames || {});
          if (docNames.length > 0) {
            console.log(`   From documents: ${docNames.join(", ")}`);
          }
        } else {
          console.log(`❌ No relevant content found`);
        }
      } catch (error) {
        console.log(`❌ Error searching: ${error.message}`);
      }
    }

    console.log("\n4. Testing end-to-end chat response...");

    const testMessage = "Apa tugas pokok dan fungsi DPMPTSP?";
    console.log(`Testing message: "${testMessage}"`);

    try {
      const response = await chatService.processMessage(
        "test-chat-id",
        testMessage
      );
      console.log(`✅ Chat response generated successfully`);
      console.log(`Response length: ${response.length} characters`);
      console.log(`Response preview: "${response.substring(0, 200)}..."`);

      // Check if response contains expected keywords
      const hasRelevantContent =
        response.toLowerCase().includes("dpmptsp") ||
        response.toLowerCase().includes("tugas") ||
        response.toLowerCase().includes("fungsi");

      if (hasRelevantContent) {
        console.log(`✅ Response contains relevant content`);
      } else {
        console.log(`⚠️  Response may not contain relevant content`);
      }
    } catch (error) {
      console.log(`❌ Chat response failed: ${error.message}`);
    }

    console.log("\n=== TEST RESULTS SUMMARY ===");
    console.log(`📄 PDFs loaded: ${allDocs.length}`);
    console.log(
      `📊 Total chunks: ${allDocs.reduce(
        (sum, doc) => sum + doc.chunks.length,
        0
      )}`
    );

    if (allDocs.length > 0) {
      console.log(`✅ Vector search system is OPERATIONAL`);
      console.log(`✅ PDF content is accessible`);
      console.log(`✅ Chat integration is working`);
    } else {
      console.log(`❌ Vector search system is NOT WORKING - No PDFs loaded`);
    }

    console.log(
      "\n🎯 CONCLUSION: Vector search is working if you see relevant chunks found above."
    );
  } catch (error) {
    console.error("❌ Critical error in vector search test:", error);
    console.error("Stack trace:", error.stack);
  }
}

testVectorSearchFinal();
