require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Test what PDFs are actually loaded and their content
async function testPDFContent() {
  try {
    console.log('=== Checking PDF Storage Directory ===');
    
    const uploadsDir = path.join(__dirname, 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      console.log('❌ Uploads directory does not exist');
      return;
    }
    
    const files = fs.readdirSync(uploadsDir);
    console.log(`Found ${files.length} files in uploads directory:`);
    
    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      console.log(`  - ${file} (${stats.size} bytes, modified: ${stats.mtime})`);
    });
    
    // Check if there are any PDF files
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
    console.log(`\nPDF files: ${pdfFiles.length}`);
    
    if (pdfFiles.length === 0) {
      console.log('❌ No PDF files found in uploads directory');
      console.log('\n💡 This might be why your chatbot says it has no information!');
      console.log('   You need to upload PDF files through the chat interface first.');
      return;
    }
    
    // Try to read one PDF file to see its content
    if (pdfFiles.length > 0) {
      console.log(`\n=== Analyzing PDF: ${pdfFiles[0]} ===`);
      
      const pdfParse = require('pdf-parse');
      const pdfPath = path.join(uploadsDir, pdfFiles[0]);
      const dataBuffer = fs.readFileSync(pdfPath);
      
      try {
        const pdfData = await pdfParse(dataBuffer);
        console.log(`Pages: ${pdfData.numpages}`);
        console.log(`Content length: ${pdfData.text.length} characters`);
        
        // Check if it contains the expected content
        const content = pdfData.text.toLowerCase();
        const hasTasksContent = content.includes('tugas pokok') && content.includes('fungsi');
        
        console.log(`Contains "tugas pokok": ${content.includes('tugas pokok')}`);
        console.log(`Contains "fungsi": ${content.includes('fungsi')}`);
        console.log(`Contains "dpmptsp": ${content.includes('dpmptsp')}`);
        
        if (hasTasksContent) {
          console.log('✅ PDF contains the expected content about tasks and functions');
          
          // Show a snippet of the relevant content
          const lines = pdfData.text.split('\n');
          const relevantLines = lines.filter(line => 
            line.toLowerCase().includes('tugas pokok') || 
            line.toLowerCase().includes('fungsi')
          );
          
          console.log('\n=== Relevant Content Found ===');
          relevantLines.slice(0, 5).forEach(line => {
            console.log(`  ${line.trim()}`);
          });
        } else {
          console.log('❌ PDF does not contain expected content about tasks and functions');
        }
        
        // Show first 500 characters
        console.log('\n=== First 500 characters ===');
        console.log(pdfData.text.substring(0, 500));
        
      } catch (pdfError) {
        console.error('Error parsing PDF:', pdfError.message);
      }
    }
    
  } catch (error) {
    console.error('Error in test:', error);
  }
}

testPDFContent();
