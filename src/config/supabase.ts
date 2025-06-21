// src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

// Supabase client for API operations
export const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Direct PostgreSQL connection for advanced operations
export const supabasePool = new Pool({
  user: process.env.SUPABASE_DB_USER || 'postgres',
  host: process.env.SUPABASE_DB_HOST,
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false, // Supabase uses SSL
  },
});

// Database configuration interface
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

// Get Supabase configuration from environment
export const getSupabaseConfig = (): SupabaseConfig => {
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_DB_HOST',
    'SUPABASE_DB_PASSWORD'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  return {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    dbHost: process.env.SUPABASE_DB_HOST!,
    dbPort: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
    dbName: process.env.SUPABASE_DB_NAME || 'postgres',
    dbUser: process.env.SUPABASE_DB_USER || 'postgres',
    dbPassword: process.env.SUPABASE_DB_PASSWORD!,
  };
};

// Test database connection
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    const client = await supabasePool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Supabase database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Supabase database connection failed:', error);
    return false;
  }
};
