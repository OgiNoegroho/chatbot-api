// Test script to verify Gemini follows instructions to only use PDF content
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
    
    // Parse the PDF
    const pdfData = await pdfParse(dataBuffer);
    console.log(`PDF parsed successfully. Content length: ${pdfData.text.length} characters`);
    
    return pdfData.text;
  } catch (error) {
    console.error('Error reading PDF:', error);
    return null;
  }
}

// Function to query Gemini with PDF content and a question
async function queryGeminiWithQuestion(pdfContent, question) {
  try {
    console.log(`\nTesting question: "${question}"`);
    console.log('Initializing Gemini API...');
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Create a prompt with PDF content and instructions
    const prompt = `
Berikut adalah informasi dari dokumen PDF:

${pdfContent}

Berdasarkan HANYA informasi di atas, tolong jawab pertanyaan berikut:
${question}

PENTING:
1. Jika informasi dari dokumen di atas TIDAK CUKUP untuk menjawab pertanyaan dengan baik, JANGAN gunakan pengetahuan umum Anda.
2. Jika pertanyaan tidak dapat dijawab dengan informasi dari dokumen di atas, berikan respons: "Maaf, saya tidak dapat menjawab pertanyaan tersebut berdasarkan dokumen yang tersedia. Silakan ajukan pertanyaan lain terkait dokumen atau unggah dokumen tambahan yang berisi informasi yang Anda butuhkan."
3. JANGAN PERNAH membuat informasi atau menjawab pertanyaan yang tidak ada dalam dokumen di atas.
`;
    
    console.log('Sending request to Gemini...');
    
    // Generate content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('\nGemini Response:');
    console.log('----------------');
    console.log(text);
    console.log('----------------\n');
    
    return text;
  } catch (error) {
    console.error('Error querying Gemini:', error);
    return null;
  }
}

// Main function
async function main() {
  console.log('Starting Gemini PDF constraints test...');
  
  // Read the PDF
  const pdfContent = await readPDF(pdfPath);
  
  if (!pdfContent) {
    console.error('Failed to read PDF content. Exiting.');
    return;
  }
  
  // Test questions - some should be answerable from the PDF, others should not
  const questions = [
    // Question that should be answerable from the PDF
    "Apa alamat DPMPTSP Kota Pekanbaru?",
    
    // Question that might be partially answerable
    "Apa saja jenis layanan perizinan yang ditawarkan DPMPTSP?",
    
    // Question that should not be answerable from the PDF
    "Berapa jumlah penduduk Kota Pekanbaru pada tahun 2023?",
    
    // Another question that should not be in the PDF
    "Siapa nama presiden indonesia ke 5?"
  ];
  
  // Query Gemini with each question
  for (const question of questions) {
    await queryGeminiWithQuestion(pdfContent, question);
  }
  
  console.log('Test completed.');
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
});
