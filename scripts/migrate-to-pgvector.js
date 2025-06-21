const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Migration script to upgrade database to pgvector
async function migrateToPgVector() {
  console.log('=== MIGRATING TO PGVECTOR ===\n');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    // Check if pgvector extension is available
    console.log('1. Checking pgvector extension availability...');
    const extensionCheck = await pool.query(
      "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
    );

    if (extensionCheck.rows.length === 0) {
      console.error('❌ pgvector extension is not available in this PostgreSQL installation.');
      console.error('Please install pgvector first:');
      console.error('- Ubuntu/Debian: Follow instructions in pgvector-implementation.md');
      console.error('- Docker: Use postgres image with pgvector pre-installed');
      console.error('- Windows: Download pre-built binaries from pgvector releases');
      process.exit(1);
    }

    console.log('✅ pgvector extension is available');

    // Read migration SQL file
    console.log('2. Reading migration SQL file...');
    const migrationPath = path.join(process.cwd(), 'migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error('❌ migration.sql file not found');
      console.error('Please ensure migration.sql exists in the project root');
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.log('✅ Migration SQL loaded');

    // Execute migration
    console.log('3. Executing migration...');
    await pool.query(migrationSQL);
    console.log('✅ Migration executed successfully');

    // Verify tables were created
    console.log('4. Verifying table creation...');
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'chatbot' 
      AND table_name IN ('pdf_documents', 'pdf_chunks', 'vector_embeddings')
      ORDER BY table_name
    `);

    console.log('Created tables:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✅ chatbot.${row.table_name}`);
    });

    // Check vector extension
    console.log('5. Verifying pgvector extension...');
    const vectorCheck = await pool.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'"
    );

    if (vectorCheck.rows.length > 0) {
      console.log(`✅ pgvector extension enabled (version: ${vectorCheck.rows[0].extversion})`);
    } else {
      console.log('⚠️  pgvector extension not enabled yet');
    }

    // Test vector operations
    console.log('6. Testing vector operations...');
    try {
      await pool.query("SELECT '[1,2,3]'::vector(3)");
      console.log('✅ Vector operations working');
    } catch (error) {
      console.log('⚠️  Vector operations test failed:', error.message);
    }

    console.log('\n=== MIGRATION COMPLETED SUCCESSFULLY ===');
    console.log('Next steps:');
    console.log('1. Update your application to use ChatPgVectorService');
    console.log('2. Test the new implementation with test-pgvector.js');
    console.log('3. Upload PDFs to populate the vector database');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  // Load environment variables
  require('dotenv').config();
  
  migrateToPgVector().catch(error => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
}

module.exports = { migrateToPgVector };
