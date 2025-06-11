require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Test the actual PDF storage location
async function testPDFStorage() {
  try {
    console.log('=== Checking Correct PDF Storage Directory ===');
    
    const pdfStoragePath = path.join(process.cwd(), "uploads", "pdfs");
    console.log(`PDF storage path: ${pdfStoragePath}`);
    
    if (!fs.existsSync(pdfStoragePath)) {
      console.log('❌ PDF storage directory does not exist');
      console.log('💡 This explains why your chatbot has no information!');
      return;
    }
    
    const files = fs.readdirSync(pdfStoragePath);
    console.log(`Found ${files.length} files in PDF storage directory:`);
    
    files.forEach(file => {
      const filePath = path.join(pdfStoragePath, file);
      const stats = fs.statSync(filePath);
      console.log(`  - ${file} (${stats.size} bytes, modified: ${stats.mtime})`);
    });
    
    // Check if there are any PDF files
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
    console.log(`\nPDF files: ${pdfFiles.length}`);
    
    if (pdfFiles.length === 0) {
      console.log('❌ No PDF files found in PDF storage directory');
      console.log('\n💡 SOLUTION: You need to upload PDF files through the chat interface!');
      console.log('   1. Start your backend server');
      console.log('   2. Use the chat interface to upload PDF files');
      console.log('   3. The files will be stored here and indexed for search');
      return;
    }
    
    // Analyze the first PDF file
    if (pdfFiles.length > 0) {
      console.log(`\n=== Analyzing PDF: ${pdfFiles[0]} ===`);
      
      const pdfParse = require('pdf-parse');
      const pdfPath = path.join(pdfStoragePath, pdfFiles[0]);
      const dataBuffer = fs.readFileSync(pdfPath);
      
      try {
        const pdfData = await pdfParse(dataBuffer);
        console.log(`Pages: ${pdfData.numpages}`);
        console.log(`Content length: ${pdfData.text.length} characters`);
        
        // Check if it contains the expected content
        const content = pdfData.text.toLowerCase();
        
        console.log(`Contains "tugas pokok": ${content.includes('tugas pokok')}`);
        console.log(`Contains "fungsi": ${content.includes('fungsi')}`);
        console.log(`Contains "dpmptsp": ${content.includes('dpmptsp')}`);
        
        // Show first 500 characters
        console.log('\n=== First 500 characters ===');
        console.log(pdfData.text.substring(0, 500));
        
        // Test chunking logic
        console.log('\n=== Testing Chunking Logic ===');
        const paragraphs = pdfData.text.split(/\n{2,}/);
        const substantialParagraphs = paragraphs.filter(p => p.trim().length > 30);
        
        console.log(`Total paragraphs: ${paragraphs.length}`);
        console.log(`Substantial paragraphs (>30 chars): ${substantialParagraphs.length}`);
        
        // Show first few chunks
        console.log('\n=== First 3 chunks ===');
        substantialParagraphs.slice(0, 3).forEach((chunk, index) => {
          console.log(`Chunk ${index + 1}: ${chunk.trim().substring(0, 100)}...`);
        });
        
      } catch (pdfError) {
        console.error('Error parsing PDF:', pdfError.message);
      }
    }
    
  } catch (error) {
    console.error('Error in test:', error);
  }
}

testPDFStorage();
