require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { ChatService } = require("../dist/services/chat");
const { PDFService } = require("../dist/services/pdf");

// Comprehensive vector search test
async function testVectorSearch() {
  try {
    console.log("=== COMPREHENSIVE VECTOR SEARCH TEST ===\n");

    // Initialize services
    const chatService = new ChatService();
    const pdfService = new PDFService();

    console.log("1. Testing PDF Service - Loading existing PDFs...");
    const allDocs = pdfService.getAllDocuments();
    console.log(`Found ${allDocs.length} PDF documents in storage:`);
    allDocs.forEach((doc, index) => {
      console.log(
        `  ${index + 1}. ${doc.name} (ID: ${doc.id}) - ${
          doc.chunks.length
        } chunks`
      );
    });

    if (allDocs.length === 0) {
      console.log("❌ No PDFs found! Please upload some PDFs first.");
      return;
    }

    console.log("\n2. Testing Vector Store - Checking vector entries...");
    // Get vector store stats
    // const stats = vectorStore.getStats();
    // console.log(`Vector store contains ${stats.entryCount} entries`);

    // if (stats.entryCount === 0) {
    //   console.log("⚠️  Vector store is empty! Re-indexing PDFs...");

    //   // Re-index all PDFs
    //   for (const doc of allDocs) {
    //     console.log(`  Indexing ${doc.name}...`);
    //     await vectorStore.addChunks(doc.chunks);
    //   }

    //   const newStats = vectorStore.getStats();
    //   console.log(`✅ Re-indexed ${newStats.entryCount} chunks`);
    // }

    console.log("\n3. Testing Vector Search with various queries...");

    const testQueries = [
      "apa tugas pokok dan fungsi dpmptsp",
      "tugas dpmptsp",
      "fungsi dpmptsp",
      "layanan perizinan",
      "penanaman modal",
      "investasi",
      "DPMPTSP",
      "pelayanan terpadu",
    ];

    for (const query of testQueries) {
      console.log(`\n--- Testing query: "${query}" ---`);

      // Test vector search directly
      // const vectorResults = await vectorStore.search(query, 5);
      // console.log(`Vector search found ${vectorResults.length} results:`);

      // vectorResults.forEach((result, index) => {
      //   console.log(
      //     `  ${index + 1}. Score: ${result.score.toFixed(
      //       4
      //     )} - "${result.chunk.content.substring(0, 100)}..."`
      //   );
      // });

      // // Test with similarity threshold
      // const SIMILARITY_THRESHOLD = 0.2;
      // const relevantResults = vectorResults.filter(
      //   (r) => r.score >= SIMILARITY_THRESHOLD
      // );
      // console.log(
      //   `Results above threshold (${SIMILARITY_THRESHOLD}): ${relevantResults.length}`
      // );

      // Test text search fallback
      const textResults = pdfService.searchInDocuments(query);
      console.log(`Text search found ${textResults.chunks.length} results`);

      // Test full chat service integration
      const pdfContent = await chatService.findRelevantPDFContent(query);
      if (pdfContent && pdfContent.chunks.length > 0) {
        console.log(
          `✅ Chat service found ${pdfContent.chunks.length} relevant chunks`
        );
      } else {
        console.log(`❌ Chat service found no relevant content`);
      }
    }

    console.log("\n4. Testing Vector Similarity Calculation...");

    // Test vector similarity with known content
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });

    const testQuery = "tugas pokok dan fungsi dpmptsp";
    const testContent =
      "DPMPTSP bertugas merumuskan dan melaksanakan kebijakan bidang penanaman modal";

    const queryResult = await embeddingModel.embedContent(testQuery);
    const contentResult = await embeddingModel.embedContent(testContent);

    const queryVector = queryResult.embedding.values;
    const contentVector = contentResult.embedding.values;

    // Calculate cosine similarity
    function cosineSimilarity(vecA, vecB) {
      if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same dimensions");
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      if (normA === 0 || normB === 0) {
        return 0;
      }

      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    const similarity = cosineSimilarity(queryVector, contentVector);
    console.log(`Direct similarity calculation: ${similarity.toFixed(4)}`);
    console.log(`Current threshold: 0.2`);
    console.log(`Would pass threshold: ${similarity >= 0.2}`);

    console.log("\n5. Testing End-to-End Chat Flow...");

    // Test the complete chat flow
    const testMessage = "Apa tugas pokok dan fungsi DPMPTSP?";
    console.log(`Testing message: "${testMessage}"`);

    try {
      // This should trigger the full search and response generation
      const response = await chatService.processMessage(
        "test-chat-id",
        testMessage
      );
      console.log(`✅ Chat response generated successfully`);
      console.log(`Response preview: "${response.substring(0, 200)}..."`);
    } catch (error) {
      console.log(`❌ Chat response failed: ${error.message}`);
    }

    console.log("\n=== TEST SUMMARY ===");
    // const finalStats = vectorStore.getStats();
    console.log(`📄 PDFs loaded: ${allDocs.length}`);
    // console.log(`🔍 Vector entries: ${finalStats.entryCount}`);
    // console.log(
    //   `✅ Vector search is ${
    //     finalStats.entryCount > 0 ? "WORKING" : "NOT WORKING"
    //   }`
    // );
  } catch (error) {
    console.error("❌ Error in vector search test:", error);
    console.error("Stack trace:", error.stack);
  }
}

testVectorSearch();
