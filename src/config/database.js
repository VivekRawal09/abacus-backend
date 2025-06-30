const { createClient } = require('@supabase/supabase-js');

// Validate required environment variables
const validateEnvironment = () => {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    console.error('📋 Please set the following in your .env file:');
    missing.forEach(key => {
      console.error(`   ${key}=your_value_here`);
    });
    process.exit(1);
  }
};

// Validate environment on startup
validateEnvironment();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Additional validation for URL format
if (!supabaseUrl.includes('supabase.co')) {
  console.error('❌ Invalid Supabase URL format');
  process.exit(1);
}

// ✅ FIXED: Correct Supabase configuration (removed invalid poolSize options)
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'X-Client-Info': 'abacus-backend@1.0.0'
    }
  },
  // ✅ PERFORMANCE: Use optimized fetch configuration
  fetch: (url, options = {}) => {
    return fetch(url, {
      ...options,
      keepalive: true,
      // Connection reuse for better performance
      agent: process.env.NODE_ENV === 'production' ? undefined : false
    });
  }
});

const testConnection = async () => {
  try {
    console.log('🔄 Testing database connection...');
    
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Database connection failed:', error.message);
      console.error('🔍 Check your Supabase credentials and network connection');
      process.exit(1);
    }

    console.log('✅ Database connected successfully');
    
    // ✅ FIXED: Safer URL logging (don't expose full URL)
    const urlParts = supabaseUrl.replace(/https?:\/\//, '').split('.');
    console.log(`🌐 Connected to: ${urlParts[0]}.supabase.co`);
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('🔍 Possible issues:');
    console.error('   - Invalid Supabase URL or key');
    console.error('   - Network connectivity problems');
    console.error('   - Supabase service outage');
    process.exit(1);
  }
};

module.exports = { supabase, testConnection };