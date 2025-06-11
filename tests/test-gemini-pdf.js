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
    console.log(`Content length: ${pdfData.text.length} characters`);
    
    return pdfData.text;
  } catch (error) {
    console.error('Error reading PDF:', error);
    return null;
  }
}

// Function to query Gemini with PDF content
async function queryGeminiWithPDF(pdfContent) {
  try {
    console.log('\nInitializing Gemini API...');
    
    // Check if API key exists
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not found in environment variables');
      return null;
    }
    
    console.log('API key found, initializing Gemini...');
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    // Create a prompt with PDF content
    const prompt = `
Berikut adalah informasi dari dokumen PDF:

${pdfContent}

Berdasarkan HANYA informasi di atas, tolong berikan ringkasan singkat tentang isi dokumen tersebut.
Jika dokumen tidak memiliki informasi yang cukup, katakan bahwa dokumen tidak memiliki konten yang bermakna.
`;
    
    console.log('Sending request to Gemini...');
    
    // Generate content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('\nGemini Response:');
    console.log('----------------');
    console.log(text);
    
    return text;
  } catch (error) {
    console.error('Error querying Gemini:', error);
    console.error('Error details:', error.message);
    return null;
  }
}

// Main function
async function main() {
  console.log('Starting Gemini PDF access test...');
  
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
