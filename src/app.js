const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { testConnection } = require('./config/database');
const { 
  compressionMiddleware, 
  performanceMonitor, 
  responseCacheMiddleware 
} = require('./middleware/performance');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ ENHANCED: CORS configuration with performance optimizations
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://abacus-admin-panel.netlify.app',
  'https://your-production-domain.com' // Add your production domain
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.log('🚫 CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Response-Time', 'X-Cache']
}));

// ✅ PERFORMANCE MIDDLEWARE (Order is critical!)
app.use(compressionMiddleware);           // 1. Compress responses first
app.use(performanceMonitor.middleware()); // 2. Monitor performance
app.use(responseCacheMiddleware(300000)); // 3. Cache responses (5 min)

// ✅ SECURITY: Rate limiting headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Body parsing with increased limits for file uploads
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Add request size header for monitoring
    req.headers['x-request-size'] = buf.length;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ ENHANCED: Request logging middleware with performance tracking
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = req.headers['x-request-id'] || Date.now().toString();
  
  console.log(`📝 ${timestamp} - ${req.method} ${req.path} [${requestId}]`);
  
  // Enhanced logging for specific operations
  if (req.method === 'POST' && req.path.includes('import')) {
    console.log('📁 Import request details:', {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      authorization: req.headers['authorization'] ? '✅ Present' : '❌ Missing',
      requestId
    });
  }
  
  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ✅ ENHANCED: Health check with comprehensive system info
app.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  const { queryCache, statsCache, publicCache } = require('./utils/cacheUtils');
  
  // Calculate cache statistics
  const cacheStats = {
    query: queryCache.getStats(),
    stats: statsCache.getStats(),
    public: publicCache.getStats()
  };
  
  const totalCacheEntries = cacheStats.query.size + cacheStats.stats.size + cacheStats.public.size;
  
  res.json({
    success: true,
    status: 'healthy',
    message: 'ABACUS Learning Platform API is running optimally',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    server: {
      uptime: Math.round(uptime),
      nodeVersion: process.version,
      platform: process.platform
    },
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      usage: `${Math.round(memoryUsage.heapUsed / memoryUsage.heapTotal * 100)}%`
    },
    cache: {
      totalEntries: totalCacheEntries,
      queryHitRate: cacheStats.query.hitRate,
      statsHitRate: cacheStats.stats.hitRate,
      publicHitRate: cacheStats.public.hitRate
    },
    features: {
      compression: '✅ Enabled',
      monitoring: '✅ Enabled',
      caching: '✅ Enabled',
      rateLimit: '✅ Planned'
    }
  });
});

// ✅ API Routes (organized by priority)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));     // ✅ NEW: Admin routes for monitoring
app.use('/api/users', require('./routes/users'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/institutes', require('./routes/institutes'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/mobile', require('./routes/mobile'));
app.use('/api/mobile', require('./routes/mobile'));
app.use('/api/students', require('./routes/students'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/assessments', require('./routes/assessments'));

// ✅ ENHANCED: 404 handler with helpful suggestions
app.use('*', (req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl}`);
  
  // Suggest similar routes`
  const suggestions = [];
  const path = req.originalUrl.toLowerCase();
  
  if (path.includes('user')) suggestions.push('/api/users');
  if (path.includes('video')) suggestions.push('/api/videos');
  if (path.includes('institute')) suggestions.push('/api/institutes');
  if (path.includes('auth') || path.includes('login')) suggestions.push('/api/auth/login');
  if (path.includes('admin')) suggestions.push('/api/admin/performance');
  if (path.includes('health')) suggestions.push('/health');
  
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    suggestions: suggestions.length > 0 ? suggestions : [
      '/health',
      '/api/auth/login',
      '/api/users',
      '/api/videos',
      '/api/admin/performance'
    ],
    timestamp: new Date().toISOString()
  });
});

// ✅ ENHANCED: Global error handler with performance impact tracking
app.use((error, req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestId = res.getHeader('X-Request-ID') || 'unknown';
  
  console.error('=================================');
  console.error('❌ ERROR OCCURRED:');
  console.error('Time:', timestamp);
  console.error('Request ID:', requestId);
  console.error('Method:', req.method);
  console.error('URL:', req.originalUrl);
  console.error('User-Agent:', req.headers['user-agent']);
  console.error('IP:', req.ip || req.connection.remoteAddress);
  console.error('Error:', error.message);
  
  if (process.env.NODE_ENV === 'development') {
    console.error('Stack:', error.stack);
    console.error('Headers:', JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
      console.error('Body:', JSON.stringify(req.body, null, 2));
    }
  }
  console.error('=================================');

  // Handle specific error types with appropriate responses
  let statusCode = 500;
  let message = 'Internal server error';
  let details = null;

  if (error.message && error.message.includes('CORS')) {
    statusCode = 403;
    message = 'CORS policy violation';
    details = 'Origin not allowed by CORS policy';
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File too large';
    details = 'Maximum file size is 10MB';
  } else if (error.type === 'entity.too.large') {
    statusCode = 400;
    message = 'Request payload too large';
    details = 'Reduce the size of your request';
  } else if (error.message && error.message.includes('JWT')) {
    statusCode = 401;
    message = 'Authentication failed';
    details = process.env.NODE_ENV === 'development' ? error.message : 'Invalid or expired token';
  } else if (error.message && error.message.includes('permission')) {
    statusCode = 403;
    message = 'Insufficient permissions';
    details = 'You do not have permission to perform this action';
  } else if (process.env.NODE_ENV === 'development') {
    message = error.message;
    details = error.stack;
  }

  // Enhanced error response with debugging info
  res.status(statusCode).json({
    success: false,
    message: message,
    details: details,
    errorCode: error.code || 'UNKNOWN',
    requestId: requestId,
    timestamp: timestamp,
    ...(process.env.NODE_ENV === 'development' && {
      debug: {
        originalError: error.message,
        path: req.originalUrl,
        method: req.method
      }
    })
  });
});

// ✅ ENHANCED: Graceful shutdown with cleanup
const gracefulShutdown = (signal) => {
  console.log(`📋 ${signal} received, initiating graceful shutdown...`);
  
  // Cleanup cache intervals to prevent memory leaks
  try {
    const { queryCache, statsCache, publicCache } = require('./utils/cacheUtils');
    console.log('🧹 Cleaning up cache intervals...');
    queryCache.destroy();
    statsCache.destroy();
    publicCache.destroy();
    console.log('✅ Cache cleanup completed');
  } catch (error) {
    console.error('❌ Cache cleanup error:', error.message);
  }
  
  // Close server gracefully
  if (server) {
    server.close((err) => {
      if (err) {
        console.error('❌ Error during server shutdown:', err.message);
        process.exit(1);
      } else {
        console.log('✅ Server closed gracefully');
        process.exit(0);
      }
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      console.error('⏰ Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  } else {
    process.exit(0);
  }
};

// Process signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ✅ ENHANCED: Unhandled error handlers with better logging
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise);
  console.error('💥 Reason:', reason);
  
  // In production, you might want to restart the process
  if (process.env.NODE_ENV === 'production') {
    console.error('🔄 Restarting process due to unhandled rejection...');
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('💥 Stack:', error.stack);
  
  // Uncaught exceptions are serious - always exit
  console.error('🛑 Exiting process due to uncaught exception...');
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// ✅ ENHANCED: Server startup with comprehensive initialization
const startServer = async () => {
  try {
    console.log('🚀 Starting ABACUS Learning Platform API...');
    console.log('===========================================');
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔗 Allowed origins:', allowedOrigins);
    console.log('🎯 Port:', PORT);
    console.log('📊 Node.js version:', process.version);
    console.log('💻 Platform:', process.platform);
    console.log('===========================================');
    
    // Test database connection
    console.log('🔄 Testing database connection...');
    await testConnection();
    
    // Initialize cache systems
    console.log('🔄 Initializing cache systems...');
    const { queryCache, statsCache, publicCache } = require('./utils/cacheUtils');
    console.log('✅ Cache systems initialized');
    
    // Start server
    const server = app.listen(PORT, () => {
      console.log('===========================================');
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API Base URL: http://localhost:${PORT}/api`);
      console.log(`👑 Admin Panel: http://localhost:${PORT}/api/admin/performance`);
      console.log('===========================================');
      console.log('✅ PERFORMANCE FEATURES ENABLED:');
      console.log('   📦 Gzip Compression');
      console.log('   📊 Real-time Monitoring');
      console.log('   💾 Intelligent Caching');
      console.log('   🔧 Admin Dashboard');
      console.log('===========================================');
      console.log('🎉 Server startup complete - Ready for requests!');
    });
    
    // Store server reference for graceful shutdown
    global.server = server;
    
    // Set server timeout for large uploads
    server.timeout = 300000; // 5 minutes for large Excel imports
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('🔍 Possible issues:');
    console.error('   - Database connection failed');
    console.error('   - Port already in use');
    console.error('   - Missing environment variables');
    console.error('   - Permission issues');
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;