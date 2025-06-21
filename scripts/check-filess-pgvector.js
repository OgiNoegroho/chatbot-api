require('dotenv').config();
const { Pool } = require('pg');

// Script untuk mengecek apakah filess.io mendukung pgvector
async function checkFilessPgVector() {
  console.log('=== CHECKING FILESS.IO PGVECTOR SUPPORT ===\n');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    // Test database connection
    console.log('1. Testing filess.io database connection...');
    const connectionTest = await pool.query('SELECT version(), current_database(), current_user');
    console.log('✅ Connected to filess.io database');
    console.log(`   📋 PostgreSQL: ${connectionTest.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
    console.log(`   📋 Database: ${connectionTest.rows[0].current_database}`);
    console.log(`   📋 User: ${connectionTest.rows[0].current_user}`);

    // Check available extensions
    console.log('\n2. Checking available extensions on filess.io...');
    const availableExtensions = await pool.query(`
      SELECT name, default_version, comment
      FROM pg_available_extensions 
      WHERE name IN ('vector', 'cube', 'earthdistance', 'fuzzystrmatch', 'pg_trgm')
      ORDER BY name
    `);

    console.log('📋 Available extensions relevant to vector operations:');
    if (availableExtensions.rows.length === 0) {
      console.log('   ❌ No vector-related extensions found');
    } else {
      availableExtensions.rows.forEach(ext => {
        console.log(`   📦 ${ext.name} (v${ext.default_version}) - ${ext.comment}`);
      });
    }

    // Specifically check for pgvector
    const pgvectorCheck = await pool.query(`
      SELECT name, default_version 
      FROM pg_available_extensions 
      WHERE name = 'vector'
    `);

    console.log('\n3. Checking pgvector extension specifically...');
    if (pgvectorCheck.rows.length > 0) {
      console.log('🎉 pgvector extension IS AVAILABLE on filess.io!');
      console.log(`   📋 Version: ${pgvectorCheck.rows[0].default_version}`);
      
      // Try to enable it
      console.log('\n4. Attempting to enable pgvector extension...');
      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        console.log('✅ pgvector extension enabled successfully!');
        
        // Test vector operations
        console.log('\n5. Testing vector operations...');
        await pool.query("SELECT '[1,2,3]'::vector(3) as test_vector");
        console.log('✅ Vector operations working!');
        
        // Check vector functions
        const vectorFunctions = await pool.query(`
          SELECT proname 
          FROM pg_proc 
          WHERE proname LIKE '%vector%' OR proname IN ('cosine_distance', 'inner_product', 'l2_distance')
          ORDER BY proname
        `);
        
        if (vectorFunctions.rows.length > 0) {
          console.log('✅ Vector functions available:');
          vectorFunctions.rows.forEach(func => {
            console.log(`   🔧 ${func.proname}()`);
          });
        }
        
      } catch (error) {
        console.log(`❌ Failed to enable pgvector: ${error.message}`);
        if (error.message.includes('permission denied')) {
          console.log('   💡 You may need to contact filess.io support to enable extensions');
        }
      }
      
    } else {
      console.log('❌ pgvector extension is NOT available on filess.io');
      
      // Check alternative extensions
      console.log('\n4. Checking alternative vector solutions...');
      
      // Check cube extension (can store vectors as arrays)
      const cubeCheck = await pool.query(`
        SELECT name FROM pg_available_extensions WHERE name = 'cube'
      `);
      
      if (cubeCheck.rows.length > 0) {
        console.log('✅ cube extension available (alternative for vector storage)');
      } else {
        console.log('❌ cube extension not available');
      }
      
      // Check if we can use arrays for vectors
      console.log('\n5. Testing array-based vector storage...');
      try {
        await pool.query(`
          CREATE TEMP TABLE test_vectors (
            id SERIAL PRIMARY KEY,
            embedding FLOAT8[]
          )
        `);
        
        await pool.query(`
          INSERT INTO test_vectors (embedding) 
          VALUES (ARRAY[0.1, 0.2, 0.3, 0.4])
        `);
        
        const testResult = await pool.query(`
          SELECT embedding, array_length(embedding, 1) as dimension
          FROM test_vectors
        `);
        
        console.log('✅ Array-based vector storage works!');
        console.log(`   📋 Test vector: [${testResult.rows[0].embedding.slice(0, 4).join(', ')}]`);
        console.log(`   📋 Dimensions: ${testResult.rows[0].dimension}`);
        
      } catch (error) {
        console.log(`❌ Array-based storage failed: ${error.message}`);
      }
    }

    // Check current database size and limits
    console.log('\n6. Checking database information...');
    try {
      const dbInfo = await pool.query(`
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) as db_size,
          (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections
      `);
      
      console.log(`📊 Database size: ${dbInfo.rows[0].db_size}`);
      console.log(`📊 Max connections: ${dbInfo.rows[0].max_connections}`);
    } catch (error) {
      console.log('⚠️  Could not get database info');
    }

    // Summary and recommendations
    console.log('\n=== RECOMMENDATIONS FOR FILESS.IO ===');
    
    if (pgvectorCheck.rows.length > 0) {
      console.log('🎉 GOOD NEWS: You can use pgvector on filess.io!');
      console.log('✅ Run the migration script to create pgvector tables');
      console.log('✅ Use ChatPgVectorService for optimal performance');
    } else {
      console.log('⚠️  pgvector not available on filess.io');
      console.log('📋 Alternative solutions:');
      console.log('   1. Use array-based vector storage (FLOAT8[])');
      console.log('   2. Implement cosine similarity in SQL');
      console.log('   3. Consider switching to a pgvector-enabled provider');
      console.log('   4. Contact filess.io support to request pgvector');
    }

  } catch (error) {
    console.error('❌ Error checking filess.io database:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Hint: Check filess.io connection details');
    } else if (error.code === '28P01') {
      console.error('💡 Hint: Check filess.io credentials in .env file');
    }
  } finally {
    await pool.end();
  }
}

// Run check if this script is executed directly
if (require.main === module) {
  checkFilessPgVector().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = { checkFilessPgVector };
