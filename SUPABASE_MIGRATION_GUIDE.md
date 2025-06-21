# 🚀 Supabase Migration Guide

## Overview

This guide explains how to migrate your chatbot backend from the current database setup to Supabase PostgreSQL.

## ✅ What's Been Updated

### 1. **Package Dependencies**
- ✅ Added `@supabase/supabase-js` package
- ✅ Maintained existing `pg` library for direct database access

### 2. **Database Connection**
- ✅ Updated `src/services/chat.ts` to support Supabase PostgreSQL
- ✅ Added SSL configuration for Supabase connections
- ✅ Maintained backward compatibility with existing environment variables

### 3. **Environment Configuration**
- ✅ Added Supabase environment variables to `.env`
- ✅ Created `.env.supabase.example` template
- ✅ Maintained fallback to existing configuration

### 4. **Database Initialization**
- ✅ Enhanced table initialization with better logging
- ✅ Added pgvector extension support (if available)
- ✅ Added connection testing on startup

## 🔧 Migration Steps

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Wait for the project to be ready
4. Note down your project credentials

### Step 2: Get Supabase Credentials

From your Supabase dashboard:

1. **Project URL**: Found in Settings > API
2. **Anon Key**: Found in Settings > API
3. **Service Role Key**: Found in Settings > API (keep this secret!)
4. **Database Password**: Found in Settings > Database

### Step 3: Update Environment Variables

Replace the placeholder values in your `.env` file:

```env
# Supabase Configuration
SUPABASE_URL=https://your-actual-project-ref.supabase.co
SUPABASE_ANON_KEY=your-actual-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-actual-service-role-key

# Supabase Database Configuration
SUPABASE_DB_HOST=db.your-actual-project-ref.supabase.co
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=your-actual-database-password
```

### Step 4: Enable pgvector Extension (Optional)

If you want to use vector embeddings:

1. Go to your Supabase dashboard
2. Navigate to Database > Extensions
3. Enable the `vector` extension

### Step 5: Test the Migration

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the application:
   ```bash
   npm run dev
   ```

3. Check the console for connection messages:
   - ✅ "Supabase database connection successful"
   - ✅ "Supabase database tables initialized successfully"

### Step 6: Migrate Existing Data (Optional)

If you have existing data to migrate:

1. Export data from your current database
2. Import data into Supabase using the SQL editor or pg_dump/pg_restore

## 🔄 Backward Compatibility

The updated code maintains backward compatibility:

- If Supabase environment variables are not set, it falls back to existing `DB_*` variables
- Existing functionality remains unchanged
- No breaking changes to the API

## 🛠️ Configuration Options

### Environment Variables Priority

1. **Supabase variables** (highest priority):
   - `SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, etc.

2. **Fallback variables**:
   - `DB_HOST`, `DB_USER`, etc.

### SSL Configuration

Supabase requires SSL connections. The code automatically configures:
```javascript
ssl: {
  rejectUnauthorized: false
}
```

## 🔍 Troubleshooting

### Connection Issues

1. **Check credentials**: Ensure all Supabase credentials are correct
2. **Check network**: Ensure your server can reach Supabase
3. **Check SSL**: Supabase requires SSL connections

### Common Error Messages

- **"Connection refused"**: Check host and port
- **"Password authentication failed"**: Check username and password
- **"SSL required"**: Ensure SSL is configured (automatically handled)

### Debug Mode

Enable debug logging by checking the console output:
- ✅ Green checkmarks indicate success
- ❌ Red X marks indicate errors
- ⚠️ Yellow warnings indicate non-critical issues

## 📊 Benefits of Supabase

1. **Managed PostgreSQL**: No server maintenance required
2. **Built-in Extensions**: pgvector, PostGIS, and more available
3. **Real-time Features**: Built-in real-time subscriptions
4. **Dashboard**: Easy database management through web interface
5. **Automatic Backups**: Built-in backup and restore
6. **Scalability**: Automatic scaling based on usage

## 🚀 Next Steps

After successful migration:

1. **Test all functionality**: Ensure chat, PDF upload, and search work
2. **Monitor performance**: Check response times and connection stability
3. **Set up monitoring**: Use Supabase dashboard for monitoring
4. **Consider optimizations**: Enable additional extensions if needed

## 📞 Support

If you encounter issues:

1. Check the console logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test the connection using the Supabase dashboard
4. Refer to [Supabase documentation](https://supabase.com/docs)

---

**Note**: This migration maintains full backward compatibility. You can switch back to your previous configuration by simply updating the environment variables.
