// Test script to verify Gemini's access to PDF content
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

// Load environment variables
require('dotenv').config();

// PDF file path
const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', '55ffffac-85c5-498a-8a25-7ab4c32917ba.pdf');

// Function to read and parse PDF
async function readPDF(filePath) {
  try {
    console.log(`Reading PDF from: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return null;
    }
    
    // Read the PDF file
    const dataBuffer = fs.readFileSync(filePath);
    console.log(`PDF file size: ${dataBuffer.length} bytes`);
    
    // Parse the PDF
    const pdfData = await pdfParse(dataBuffer);
    
    console.log(`PDF parsed successfully. Page count: ${pdfData.numpages}`);
    console.log(`First 200 characters of content: ${pdfData.text.substring(0, 200)}...`);
    
    return pdfData.text;
  } catch (error) {
    console.error('Error reading PDF:', error);
    return null;
  }
}

// Function to query Gemini with PDF content
async function queryGeminiWithPDF(pdfContent) {
  try {
    console.log('Initializing Gemini API...');
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Safety settings
    const safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];
    
    // Create a prompt with PDF content
    const prompt = `
Berikut adalah informasi dari dokumen PDF:

${pdfContent}

Berdasarkan HANYA informasi di atas, tolong berikan ringkasan singkat tentang isi dokumen tersebut.
Jika dokumen tidak memiliki informasi yang cukup, katakan bahwa dokumen tidak memiliki konten yang bermakna.
`;
    
    console.log('Sending request to Gemini...');
    
    // Start a chat session
    const chat = model.startChat({
      safetySettings,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    });
    
    // Send the message
    const result = await chat.sendMessage(prompt);
    const response = result.response;
    
    console.log('\nGemini Response:');
    console.log('----------------');
    console.log(response.text());
    
    return response.text();
  } catch (error) {
    console.error('Error querying Gemini:', error);
    return null;
  }
}

// Main function
async function main() {
  console.log('Starting PDF access test...');
  
  // Read the PDF
  const pdfContent = await readPDF(pdfPath);
  
  if (!pdfContent) {
    console.error('Failed to read PDF content. Exiting.');
    return;
  }
  
  // Query Gemini with the PDF content
  await queryGeminiWithPDF(pdfContent);
  
  console.log('\nTest completed.');
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
});
