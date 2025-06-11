// Simple script to read a PDF file
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// PDF file path
const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', '55ffffac-85c5-498a-8a25-7ab4c32917ba.pdf');

// Function to read and parse PDF
async function readPDF(filePath) {
  try {
    console.log(`Reading PDF from: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return;
    }
    
    // Read the PDF file
    const dataBuffer = fs.readFileSync(filePath);
    console.log(`PDF file size: ${dataBuffer.length} bytes`);
    
    // Parse the PDF
    const pdfData = await pdfParse(dataBuffer);
    
    console.log(`PDF parsed successfully. Page count: ${pdfData.numpages}`);
    console.log(`Content length: ${pdfData.text.length} characters`);
    console.log(`\nFirst 500 characters of content:`);
    console.log('-----------------------------------');
    console.log(pdfData.text.substring(0, 500));
    console.log('-----------------------------------');
    
  } catch (error) {
    console.error('Error reading PDF:', error);
  }
}

// Main function
async function main() {
  console.log('Starting PDF read test...');
  await readPDF(pdfPath);
  console.log('\nTest completed.');
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
});
