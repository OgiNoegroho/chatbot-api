require('dotenv').config();
const { Pool } = require('pg');

// Script untuk mengecek apakah tabel pgvector sudah ada di database
async function checkDatabaseTables() {
  console.log('=== CHECKING DATABASE TABLES ===\n');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    // Test database connection
    console.log('1. Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');

    // Check if chatbot schema exists
    console.log('\n2. Checking chatbot schema...');
    const schemaCheck = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'chatbot'
    `);

    if (schemaCheck.rows.length > 0) {
      console.log('✅ Schema "chatbot" exists');
    } else {
      console.log('❌ Schema "chatbot" does not exist');
      console.log('   Run migration first: node scripts/migrate-to-pgvector.js');
      return;
    }

    // Check existing tables in chatbot schema
    console.log('\n3. Checking existing tables in chatbot schema...');
    const tablesCheck = await pool.query(`
      SELECT table_name, 
             pg_size_pretty(pg_total_relation_size('chatbot.' || table_name)) as size
      FROM information_schema.tables 
      WHERE table_schema = 'chatbot' 
      ORDER BY table_name
    `);

    console.log('📋 Tables found in chatbot schema:');
    if (tablesCheck.rows.length === 0) {
      console.log('   No tables found in chatbot schema');
    } else {
      tablesCheck.rows.forEach(row => {
        console.log(`   📄 ${row.table_name} (${row.size})`);
      });
    }

    // Check specific pgvector tables
    console.log('\n4. Checking pgvector-specific tables...');
    const requiredTables = [
      'pdf_documents',
      'pdf_chunks', 
      'vector_embeddings'
    ];

    const existingTables = tablesCheck.rows.map(row => row.table_name);
    
    for (const tableName of requiredTables) {
      if (existingTables.includes(tableName)) {
        console.log(`✅ chatbot.${tableName} exists`);
        
        // Get row count for each table
        try {
          const countResult = await pool.query(`SELECT COUNT(*) as count FROM chatbot.${tableName}`);
          const count = countResult.rows[0].count;
          console.log(`   📊 Contains ${count} rows`);
        } catch (error) {
          console.log(`   ⚠️  Could not get row count: ${error.message}`);
        }
      } else {
        console.log(`❌ chatbot.${tableName} does not exist`);
      }
    }

    // Check pgvector extension
    console.log('\n5. Checking pgvector extension...');
    const extensionCheck = await pool.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `);

    if (extensionCheck.rows.length > 0) {
      const version = extensionCheck.rows[0].extversion;
      console.log(`✅ pgvector extension is installed (version: ${version})`);
    } else {
      console.log('❌ pgvector extension is not installed');
      console.log('   Install pgvector first before running migration');
    }

    // Check if pgvector is available (even if not enabled)
    const availableCheck = await pool.query(`
      SELECT name 
      FROM pg_available_extensions 
      WHERE name = 'vector'
    `);

    if (availableCheck.rows.length > 0) {
      console.log('✅ pgvector extension is available for installation');
    } else {
      console.log('❌ pgvector extension is not available');
      console.log('   Install pgvector system package first');
    }

    // Check vector data type usage
    if (existingTables.includes('vector_embeddings')) {
      console.log('\n6. Checking vector column in vector_embeddings table...');
      
      try {
        const columnCheck = await pool.query(`
          SELECT column_name, data_type, udt_name
          FROM information_schema.columns 
          WHERE table_schema = 'chatbot' 
          AND table_name = 'vector_embeddings' 
          AND column_name = 'embedding_vector'
        `);

        if (columnCheck.rows.length > 0) {
          const column = columnCheck.rows[0];
          console.log(`✅ embedding_vector column exists`);
          console.log(`   📋 Data type: ${column.data_type} (${column.udt_name})`);
          
          if (column.udt_name === 'vector') {
            console.log('✅ Using pgvector data type');
          } else {
            console.log('⚠️  Not using pgvector data type');
          }
        } else {
          console.log('❌ embedding_vector column not found');
        }
      } catch (error) {
        console.log(`⚠️  Could not check vector column: ${error.message}`);
      }
    }

    // Check indexes
    console.log('\n7. Checking pgvector indexes...');
    if (existingTables.includes('vector_embeddings')) {
      try {
        const indexCheck = await pool.query(`
          SELECT indexname, indexdef
          FROM pg_indexes 
          WHERE schemaname = 'chatbot' 
          AND tablename = 'vector_embeddings'
          AND indexname LIKE '%hnsw%'
        `);

        if (indexCheck.rows.length > 0) {
          console.log('✅ HNSW vector index found:');
          indexCheck.rows.forEach(row => {
            console.log(`   🔍 ${row.indexname}`);
          });
        } else {
          console.log('⚠️  No HNSW vector index found');
          console.log('   Vector search may be slow without proper indexing');
        }
      } catch (error) {
        console.log(`⚠️  Could not check indexes: ${error.message}`);
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    const allTablesExist = requiredTables.every(table => existingTables.includes(table));
    const pgvectorInstalled = extensionCheck.rows.length > 0;

    if (allTablesExist && pgvectorInstalled) {
      console.log('🎉 pgvector implementation is READY!');
      console.log('✅ All required tables exist');
      console.log('✅ pgvector extension is installed');
      console.log('✅ You can use ChatPgVectorService');
    } else if (allTablesExist && !pgvectorInstalled) {
      console.log('⚠️  Tables exist but pgvector extension not installed');
      console.log('   Install pgvector extension first');
    } else if (!allTablesExist && pgvectorInstalled) {
      console.log('⚠️  pgvector extension installed but tables missing');
      console.log('   Run migration: node scripts/migrate-to-pgvector.js');
    } else {
      console.log('❌ pgvector implementation NOT ready');
      console.log('   1. Install pgvector extension');
      console.log('   2. Run migration script');
    }

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Hint: Make sure PostgreSQL is running');
    } else if (error.code === '28P01') {
      console.error('💡 Hint: Check database credentials in .env file');
    } else if (error.code === '3D000') {
      console.error('💡 Hint: Database does not exist, create it first');
    }
  } finally {
    await pool.end();
  }
}

// Run check if this script is executed directly
if (require.main === module) {
  checkDatabaseTables().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = { checkDatabaseTables };
