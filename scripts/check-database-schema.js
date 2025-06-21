require('dotenv').config();
const { Pool } = require('pg');

/**
 * Script to check if the chatbot tables exist in Supabase database
 */
async function checkDatabaseSchema() {
  console.log('🔍 Checking Supabase Database Schema...\n');

  // Create connection pool
  const pool = new Pool({
    user: process.env.SUPABASE_DB_USER || process.env.DB_USER,
    host: process.env.SUPABASE_DB_HOST || process.env.DB_HOST,
    database: process.env.SUPABASE_DB_NAME || process.env.DB_NAME,
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    port: parseInt(process.env.SUPABASE_DB_PORT || process.env.DB_PORT || '5432'),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected to Supabase database\n');

    // Check if chatbot schema exists
    console.log('📋 Checking schemas...');
    const schemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'chatbot'
    `);

    if (schemaResult.rows.length > 0) {
      console.log('✅ Schema "chatbot" exists');
    } else {
      console.log('❌ Schema "chatbot" does not exist');
      console.log('   Tables will be created when the application starts');
      client.release();
      await pool.end();
      return;
    }

    // Check for tables in chatbot schema
    console.log('\n📊 Checking tables in chatbot schema...');
    const tablesResult = await client.query(`
      SELECT table_name, table_type
      FROM information_schema.tables 
      WHERE table_schema = 'chatbot'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      console.log('❌ No tables found in chatbot schema');
    } else {
      console.log(`✅ Found ${tablesResult.rows.length} table(s):`);
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name} (${row.table_type})`);
      });
    }

    // Check specific required tables
    console.log('\n🔍 Checking required tables...');
    const requiredTables = ['chats', 'messages', 'pdf_documents', 'pdf_chunks', 'vector_embeddings'];
    
    for (const tableName of requiredTables) {
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'chatbot' 
          AND table_name = $1
        )
      `, [tableName]);

      const exists = tableCheck.rows[0].exists;
      if (exists) {
        console.log(`✅ Table "chatbot.${tableName}" exists`);
        
        // Get row count
        try {
          const countResult = await client.query(`SELECT COUNT(*) as count FROM chatbot.${tableName}`);
          console.log(`   └─ Contains ${countResult.rows[0].count} row(s)`);
        } catch (error) {
          console.log(`   └─ Could not count rows: ${error.message}`);
        }
      } else {
        console.log(`❌ Table "chatbot.${tableName}" does not exist`);
      }
    }

    // Check for pgvector extension
    console.log('\n🧮 Checking pgvector extension...');
    const extensionResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_extension 
        WHERE extname = 'vector'
      )
    `);

    if (extensionResult.rows[0].exists) {
      console.log('✅ pgvector extension is installed');
    } else {
      console.log('❌ pgvector extension is not installed');
    }

    // Check indexes
    console.log('\n📇 Checking indexes...');
    const indexResult = await client.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'chatbot'
      ORDER BY tablename, indexname
    `);

    if (indexResult.rows.length === 0) {
      console.log('❌ No indexes found in chatbot schema');
    } else {
      console.log(`✅ Found ${indexResult.rows.length} index(es):`);
      indexResult.rows.forEach(row => {
        console.log(`   - ${row.indexname} on ${row.tablename}`);
      });
    }

    // Check table structures for key tables
    console.log('\n🏗️ Checking table structures...');
    
    for (const tableName of ['chats', 'messages']) {
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'chatbot' 
          AND table_name = $1
        )
      `, [tableName]);

      if (tableExists.rows[0].exists) {
        console.log(`\n📋 Structure of chatbot.${tableName}:`);
        const columnsResult = await client.query(`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns 
          WHERE table_schema = 'chatbot' 
          AND table_name = $1
          ORDER BY ordinal_position
        `, [tableName]);

        columnsResult.rows.forEach(col => {
          console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
        });
      }
    }

    client.release();
    console.log('\n🎉 Database schema check completed!');

  } catch (error) {
    console.error('\n❌ Error checking database schema:');
    console.error('Error:', error.message);
    
    if (error.code) {
      console.error('Error Code:', error.code);
    }
  } finally {
    await pool.end();
  }
}

// Run the check
checkDatabaseSchema().catch(console.error);
