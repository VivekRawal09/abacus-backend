// src/routes/admin.js - NEW FILE
const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { performanceMonitor, getMemoryStats } = require('../middleware/performance');
const { queryCache, statsCache, publicCache } = require('../utils/cacheUtils');

// All admin routes require super_admin access
router.use(authenticateToken);
router.use(authorizeRoles('super_admin'));

// ✅ GET /api/admin/performance - Performance monitoring dashboard
router.get('/performance', (req, res) => {
  try {
    const performanceStats = performanceMonitor.getStats();
    const memoryStats = getMemoryStats();
    
    res.json({
      success: true,
      data: {
        performance: performanceStats,
        memory: memoryStats,
        cache: {
          query: queryCache.getStats(),
          stats: statsCache.getStats(),
          public: publicCache.getStats()
        },
        server: {
          uptime: Math.round(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          environment: process.env.NODE_ENV || 'development'
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Performance stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance stats',
      error: error.message
    });
  }
});

// ✅ GET /api/admin/cache/stats - Cache statistics
router.get('/cache/stats', (req, res) => {
  try {
    const cacheStats = {
      query: queryCache.getStats(),
      stats: statsCache.getStats(),
      public: publicCache.getStats()
    };

    // Calculate total cache usage
    const totalEntries = cacheStats.query.size + cacheStats.stats.size + cacheStats.public.size;
    const totalMemory = cacheStats.query.memoryUsage + cacheStats.stats.memoryUsage + cacheStats.public.memoryUsage;

    res.json({
      success: true,
      data: {
        individual: cacheStats,
        summary: {
          totalEntries,
          totalMemoryMB: Math.round(totalMemory * 100) / 100,
          overallHitRate: calculateOverallHitRate(cacheStats)
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cache stats',
      error: error.message
    });
  }
});

// ✅ GET /api/admin/cache/entries - Get sample cache entries for debugging
router.get('/cache/entries', (req, res) => {
  try {
    const { type = 'query', limit = 10 } = req.query;
    
    let cache;
    switch (type) {
      case 'stats':
        cache = statsCache;
        break;
      case 'public':
        cache = publicCache;
        break;
      case 'query':
      default:
        cache = queryCache;
        break;
    }

    const entries = cache.getEntries(parseInt(limit));

    res.json({
      success: true,
      data: {
        type,
        entries,
        totalEntries: cache.getStats().size
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache entries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cache entries',
      error: error.message
    });
  }
});

// ✅ POST /api/admin/cache/clear - Clear specific or all caches
router.post('/cache/clear', (req, res) => {
  try {
    const { type } = req.body;
    
    let clearedCount = 0;
    let clearedTypes = [];
    
    switch (type) {
      case 'query':
        queryCache.clear();
        clearedCount = 1;
        clearedTypes = ['query'];
        break;
      case 'stats':
        statsCache.clear();
        clearedCount = 1;
        clearedTypes = ['stats'];
        break;
      case 'public':
        publicCache.clear();
        clearedCount = 1;
        clearedTypes = ['public'];
        break;
      case 'all':
      default:
        queryCache.clear();
        statsCache.clear();
        publicCache.clear();
        clearedCount = 3;
        clearedTypes = ['query', 'stats', 'public'];
        break;
    }
    
    console.log(`🗑️ Admin cleared ${clearedTypes.join(', ')} cache(s)`);
    
    res.json({
      success: true,
      message: `Cleared ${clearedCount} cache(s)`,
      data: { 
        type: type || 'all', 
        clearedCount,
        clearedTypes
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message
    });
  }
});

// ✅ POST /api/admin/cache/invalidate - Invalidate cache entries by pattern
router.post('/cache/invalidate', (req, res) => {
  try {
    const { pattern } = req.body;
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        message: 'Pattern is required'
      });
    }
    
    const invalidatedQuery = queryCache.invalidatePattern(pattern);
    const invalidatedStats = statsCache.invalidatePattern(pattern);
    const invalidatedPublic = publicCache.invalidatePattern(pattern);
    
    const total = invalidatedQuery + invalidatedStats + invalidatedPublic;
    
    console.log(`🗑️ Admin invalidated ${total} cache entries with pattern: ${pattern}`);
    
    res.json({
      success: true,
      message: `Invalidated ${total} cache entries`,
      data: {
        pattern,
        invalidated: {
          query: invalidatedQuery,
          stats: invalidatedStats,
          public: invalidatedPublic,
          total
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache invalidate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate cache',
      error: error.message
    });
  }
});

// ✅ POST /api/admin/performance/reset - Reset performance metrics
router.post('/performance/reset', (req, res) => {
  try {
    performanceMonitor.reset();
    
    console.log('📊 Admin reset performance metrics');
    
    res.json({
      success: true,
      message: 'Performance metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Performance reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset performance metrics',
      error: error.message
    });
  }
});

// ✅ GET /api/admin/health - Enhanced health check for monitoring
router.get('/health', (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    const performanceStats = performanceMonitor.getStats();
    
    // Calculate health score based on various metrics
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    const cacheStats = queryCache.getStats();
    
    let healthScore = 100;
    
    // Deduct points for high memory usage
    if (memoryUsagePercent > 80) healthScore -= 20;
    else if (memoryUsagePercent > 60) healthScore -= 10;
    
    // Deduct points for low cache hit rate
    const hitRate = parseFloat(cacheStats.hitRate) || 0;
    if (hitRate < 50) healthScore -= 15;
    else if (hitRate < 70) healthScore -= 5;
    
    // Deduct points for high error rate
    const totalRequests = performanceStats.summary?.totalRequests || 0;
    const totalErrors = performanceStats.summary?.totalErrors || 0;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    
    if (errorRate > 5) healthScore -= 25;
    else if (errorRate > 1) healthScore -= 10;
    
    const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'degraded' : 'unhealthy';
    
    res.json({
      success: true,
      status: healthStatus,
      score: Math.max(0, healthScore),
      data: {
        uptime: Math.round(uptime),
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          usagePercent: Math.round(memoryUsagePercent)
        },
        cache: {
          hitRate: cacheStats.hitRate,
          totalEntries: cacheStats.size
        },
        performance: {
          totalRequests,
          totalErrors,
          errorRate: `${errorRate.toFixed(2)}%`,
          slowRequests: performanceStats.summary?.slowRequestCount || 0
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to calculate overall hit rate
function calculateOverallHitRate(cacheStats) {
  const totalHits = (cacheStats.query.hitCount || 0) + (cacheStats.stats.hitCount || 0) + (cacheStats.public.hitCount || 0);
  const totalMisses = (cacheStats.query.missCount || 0) + (cacheStats.stats.missCount || 0) + (cacheStats.public.missCount || 0);
  const totalRequests = totalHits + totalMisses;
  
  return totalRequests > 0 ? `${(totalHits / totalRequests * 100).toFixed(2)}%` : '0%';
}

module.exports = router;