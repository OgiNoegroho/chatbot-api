require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Test the improved search functionality
async function testImprovedSearch() {
  try {
    console.log('=== Testing Improved Search Functionality ===');
    
    const query = "apa tugas pokok dan fungsi dpmptsp";
    const pdfContent = `Data Gabungan DPMPTSP Pekanbaru
Profil Umum
Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu (DPMPTSP) Kota Pekanbaru berlokasi di Mal Pelayanan Publik (MPP) Jl. Jend. Sudirman No. 464, Jadirejo, Kec. Sukajadi, Kota Pekanbaru, Riau 28121.

Tugas Pokok dan Fungsi
DPMPTSP Kota Pekanbaru bertugas merumuskan dan melaksanakan kebijakan bidang penanaman modal serta menyelenggarakan pelayanan administrasi penanaman modal, perizinan, dan non-perizinan secara terpadu. Fungsi utamanya meliputi perencanaan, perumusan kebijakan teknis, penyelenggaraan pelayanan terpadu, pembinaan, pengendalian, koordinasi, fasilitasi, peningkatan iklim investasi, penyusunan profil investasi, evaluasi, dan pelaporan terkait penanaman modal dan perizinan/non-perizinan di Kota Pekanbaru, berdasarkan prinsip koordinasi, integrasi, sinkronisasi, simplifikasi, keamanan, kepastian, dan transparansi.

Visi dan Misi
Visi DPMPTSP Kota Pekanbaru adalah terwujudnya pelayanan perizinan dan penanaman modal yang prima, transparan, dan akuntabel.`;

    console.log('\n=== Testing Improved Text Search (min length 2) ===');
    
    // Test improved text search logic
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2); // Changed from 3 to 2
    
    console.log('Query terms (>2 chars):', queryTerms);
    
    const chunkText = pdfContent.toLowerCase();
    const matchesTerms = queryTerms.some((term) => chunkText.includes(term));
    
    console.log('PDF content contains matching terms:', matchesTerms);
    
    // Test each term individually
    queryTerms.forEach(term => {
      const found = chunkText.includes(term);
      console.log(`  "${term}": ${found}`);
    });
    
    console.log('\n=== Testing Improved Chunking Strategy ===');
    
    // Test improved chunking with section headers
    const sectionHeaders = [
      /tugas\s+pokok\s+dan\s+fungsi/i,
      /visi\s+dan\s+misi/i,
      /struktur\s+organisasi/i,
      /layanan/i,
      /profil/i
    ];

    console.log('Section headers found:');
    for (const header of sectionHeaders) {
      const match = pdfContent.match(header);
      if (match) {
        console.log(`  ✅ "${match[0]}" found at position ${match.index}`);
        const startIndex = match.index;
        const sectionText = pdfContent.substring(startIndex, startIndex + 500);
        console.log(`     Preview: ${sectionText.substring(0, 100)}...`);
      } else {
        console.log(`  ❌ "${header.source}" not found`);
      }
    }
    
    console.log('\n=== Testing Vector Similarity with Lower Threshold ===');
    
    // Test vector similarity with lower threshold
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    
    // Generate embeddings
    const queryResult = await embeddingModel.embedContent(query);
    const contentResult = await embeddingModel.embedContent(pdfContent);
    
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
    console.log(`Similarity score: ${similarity.toFixed(4)}`);
    console.log(`Old threshold (0.5): ${similarity >= 0.5 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`New threshold (0.3): ${similarity >= 0.3 ? '✅ PASS' : '❌ FAIL'}`);
    
    // Test with the specific "Tugas Pokok dan Fungsi" section
    console.log('\n=== Testing with Specific Section ===');
    
    const tugasSection = `Tugas Pokok dan Fungsi
DPMPTSP Kota Pekanbaru bertugas merumuskan dan melaksanakan kebijakan bidang penanaman modal serta menyelenggarakan pelayanan administrasi penanaman modal, perizinan, dan non-perizinan secara terpadu. Fungsi utamanya meliputi perencanaan, perumusan kebijakan teknis, penyelenggaraan pelayanan terpadu, pembinaan, pengendalian, koordinasi, fasilitasi, peningkatan iklim investasi, penyusunan profil investasi, evaluasi, dan pelaporan terkait penanaman modal dan perizinan/non-perizinan di Kota Pekanbaru.`;
    
    const sectionResult = await embeddingModel.embedContent(tugasSection);
    const sectionVector = sectionResult.embedding.values;
    const sectionSimilarity = cosineSimilarity(queryVector, sectionVector);
    
    console.log(`Section similarity: ${sectionSimilarity.toFixed(4)}`);
    console.log(`New threshold (0.3): ${sectionSimilarity >= 0.3 ? '✅ PASS' : '❌ FAIL'}`);
    
  } catch (error) {
    console.error('Error in test:', error);
  }
}

testImprovedSearch();
