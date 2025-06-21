const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://pugdgqxljusdvltuzrdk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Z2RncXhsanVzZHZsdHV6cmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0ODc5NDIsImV4cCI6MjA2NjA2Mzk0Mn0.8J_z6EnvAhdTm9xwJasUiCFBWWCOjDmJEdrraLw-7HM';

const supabase = createClient(supabaseUrl, supabaseKey);

const testConnection = async () => {
  try {
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) throw error;
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = { supabase, testConnection };