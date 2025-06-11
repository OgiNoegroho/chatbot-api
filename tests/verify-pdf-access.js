// Script to verify PDF access in the application
const { ChatService } = require("./dist/services/chat");
const { GeminiService } = require("./dist/services/gemini");
const { PDFService } = require("./dist/services/pdf");

// Load environment variables
require("dotenv").config();

async function main() {
  console.log("Starting verification of PDF access in the application...");

  try {
    // Initialize services
    console.log("Initializing services...");
    const chatService = new ChatService();
    const geminiService = new GeminiService();
    const pdfService = new PDFService();

    // Get all available PDFs
    console.log("\nListing available PDFs:");
    const documents = pdfService.getAllDocuments();

    if (documents.length === 0) {
      console.log("No PDF documents found in the system.");
      await chatService.cleanup();
      return;
    }

    console.log(`Found ${documents.length} PDF documents:`);
    documents.forEach((doc, index) => {
      console.log(
        `  ${index + 1}. ${doc.name} (${doc.id}) - ${
          doc.metadata.pageCount
        } pages, ${doc.metadata.fileSize} bytes`
      );
    });

    // Select the first document for testing
    const testDoc = documents[0];
    console.log(`\nUsing document "${testDoc.name}" for testing...`);

    // Get chunks for the document
    const chunks = pdfService.getDocumentChunks(testDoc.id);
    console.log(`Document has ${chunks.length} chunks`);

    if (chunks.length > 0) {
      console.log("\nSample chunk content:");
      console.log("-------------------");
      console.log(chunks[0].content.substring(0, 200) + "...");
      console.log("-------------------");
    }

    // Test questions
    const questions = [
      // Question that should be answerable from the PDF
      "Apa alamat DPMPTSP Kota Pekanbaru?",

      // Question that should not be answerable from the PDF
      "Berapa jumlah penduduk Kota Pekanbaru pada tahun 2023?",
    ];

    // Create a test chat
    console.log("\nCreating test chat...");
    const chatId = await chatService.createChat();
    console.log(`Test chat created with ID: ${chatId}`);

    // Send welcome message
    await chatService.sendWelcomeMessage(chatId);

    // Process each question
    for (const question of questions) {
      console.log(`\nTesting question: "${question}"`);

      // Process the message
      const messages = await chatService.processUserMessage(chatId, question);

      // Display the response
      const response = messages[1]; // The assistant's response

      console.log("\nResponse:");
      console.log("-------------------");
      console.log(response.content);
      console.log("-------------------");
    }

    console.log("\nTest completed successfully.");

    // Clean up
    await chatService.cleanup();
  } catch (error) {
    console.error("Error during verification:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
});
