require('dotenv').config();
const { Pool } = require('pg');

/**
 * Test script to verify Supabase PostgreSQL connection
 */
async function testSupabaseConnection() {
  console.log('🔧 Testing Supabase PostgreSQL Connection...\n');

  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log(`SUPABASE_DB_HOST: ${process.env.SUPABASE_DB_HOST || 'NOT SET'}`);
  console.log(`SUPABASE_DB_PORT: ${process.env.SUPABASE_DB_PORT || 'NOT SET'}`);
  console.log(`SUPABASE_DB_NAME: ${process.env.SUPABASE_DB_NAME || 'NOT SET'}`);
  console.log(`SUPABASE_DB_USER: ${process.env.SUPABASE_DB_USER || 'NOT SET'}`);
  console.log(`SUPABASE_DB_PASSWORD: ${process.env.SUPABASE_DB_PASSWORD ? '***SET***' : 'NOT SET'}`);
  console.log('');

  // Fallback check
  if (!process.env.SUPABASE_DB_HOST) {
    console.log('⚠️ Supabase variables not set, checking fallback variables:');
    console.log(`DB_HOST: ${process.env.DB_HOST || 'NOT SET'}`);
    console.log(`DB_PORT: ${process.env.DB_PORT || 'NOT SET'}`);
    console.log(`DB_NAME: ${process.env.DB_NAME || 'NOT SET'}`);
    console.log(`DB_USER: ${process.env.DB_USER || 'NOT SET'}`);
    console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? '***SET***' : 'NOT SET'}`);
    console.log('');
  }

  // Create connection pool
  const pool = new Pool({
    user: process.env.SUPABASE_DB_USER || process.env.DB_USER,
    host: process.env.SUPABASE_DB_HOST || process.env.DB_HOST,
    database: process.env.SUPABASE_DB_NAME || process.env.DB_NAME,
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    port: parseInt(process.env.SUPABASE_DB_PORT || process.env.DB_PORT || '5432'),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: false, // Required for Supabase
    },
  });

  try {
    console.log('🔌 Attempting to connect to database...');
    
    // Test basic connection
    const client = await pool.connect();
    console.log('✅ Database connection successful!');

    // Test basic query
    console.log('📊 Testing basic query...');
    const result = await client.query('SELECT NOW() as current_time, version() as postgres_version');
    console.log(`✅ Current time: ${result.rows[0].current_time}`);
    console.log(`✅ PostgreSQL version: ${result.rows[0].postgres_version}`);

    // Test schema creation
    console.log('🏗️ Testing schema creation...');
    await client.query('CREATE SCHEMA IF NOT EXISTS test_schema');
    console.log('✅ Schema creation successful');

    // Test pgvector extension (if available)
    console.log('🧮 Testing pgvector extension...');
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('✅ pgvector extension available and enabled');
      
      // Test vector operations
      await client.query('SELECT \'[1,2,3]\'::vector(3) as test_vector');
      console.log('✅ Vector operations working');
    } catch (vectorError) {
      console.log('⚠️ pgvector extension not available (this is optional)');
    }

    // Test table creation
    console.log('📋 Testing table creation...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_schema.test_table (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table creation successful');

    // Test data insertion
    console.log('💾 Testing data insertion...');
    await client.query(`
      INSERT INTO test_schema.test_table (name) 
      VALUES ('Supabase Test') 
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Data insertion successful');

    // Test data retrieval
    console.log('📖 Testing data retrieval...');
    const dataResult = await client.query('SELECT * FROM test_schema.test_table LIMIT 1');
    console.log(`✅ Data retrieval successful: ${dataResult.rows.length} row(s) found`);

    // Cleanup test data
    console.log('🧹 Cleaning up test data...');
    await client.query('DROP TABLE IF EXISTS test_schema.test_table');
    await client.query('DROP SCHEMA IF EXISTS test_schema');
    console.log('✅ Cleanup successful');

    client.release();
    console.log('\n🎉 All tests passed! Supabase connection is working correctly.');

  } catch (error) {
    console.error('\n❌ Connection test failed:');
    console.error('Error:', error.message);
    
    if (error.code) {
      console.error('Error Code:', error.code);
    }
    
    console.error('\n🔧 Troubleshooting tips:');
    console.error('1. Check that all Supabase environment variables are set correctly');
    console.error('2. Verify your Supabase project is active and accessible');
    console.error('3. Ensure your database password is correct');
    console.error('4. Check that your network allows connections to Supabase');
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the test
testSupabaseConnection().catch(console.error);
