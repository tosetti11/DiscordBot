// One-time script to create the web_analytics table
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Check if table exists
  const { data, error } = await supabase.from('web_analytics').select('id').limit(1);
  
  if (!error) {
    console.log('✅ web_analytics table already exists');
    return;
  }

  if (error.code === '42P01') {
    console.log('Table does not exist. Creating via raw SQL...');
    
    const { error: sqlError } = await supabase.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS web_analytics (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          discord_id TEXT NOT NULL,
          discord_username TEXT,
          display_name TEXT,
          avatar TEXT,
          event_type TEXT NOT NULL CHECK (event_type IN ('login', 'pwa_install')),
          user_agent TEXT,
          ip_address TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_web_analytics_event_type ON web_analytics (event_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_web_analytics_discord_id ON web_analytics (discord_id, event_type);
      `
    });

    if (sqlError) {
      console.log('❌ Could not create via RPC. You need to run the SQL manually in Supabase dashboard.');
      console.log('SQL to run:');
      console.log(`
CREATE TABLE IF NOT EXISTS web_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  display_name TEXT,
  avatar TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('login', 'pwa_install')),
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_analytics_event_type
  ON web_analytics (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_analytics_discord_id
  ON web_analytics (discord_id, event_type);
      `);
    } else {
      console.log('✅ Table created successfully');
    }
  } else {
    console.log('Error checking table:', error.message);
  }
}

main().catch(console.error);
