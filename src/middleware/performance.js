// src/middleware/performance.js
// Complete performance middleware for enterprise-grade speed

const compression = require('compression');

/**
 * ✅ REQUEST COMPRESSION MIDDLEWARE
 * Reduces response sizes by 60-80%
 */
const compressionMiddleware = compression({
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) return false;
    
    // Always compress JSON responses
    if (res.getHeader('Content-Type')?.includes('application/json')) return true;
    
    // Don't compress if response is already compressed
    if (res.getHeader('Content-Encoding')) return false;
    
    // Use compression's default filter for other types
    return compression.filter(req, res);
  },
  level: 6, // Good balance of speed vs compression ratio (1-9 scale)
  threshold: 1024, // Only compress responses larger than 1KB
  memLevel: 8, // Memory usage vs speed trade-off (1-9 scale)
  windowBits: 15, // Compression window size
  chunkSize: 16384, // Chunk size for streaming compression
});

/**
 * ✅ PERFORMANCE MONITORING CLASS
 * Tracks response times, identifies bottlenecks, and provides insights
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requestCounts: new Map(),
      responseTimes: new Map(),
      errorCounts: new Map(),
      slowRequests: [],
      statusCodes: new Map()
    };
    this.slowThreshold = 1000; // 1 second
    this.maxSlowRequests = 100; // Keep last 100 slow requests
    this.maxResponseTimes = 1000; // Keep last 1000 response times per endpoint
  }

  middleware() {
    return (req, res, next) => {
      const startTime = process.hrtime.bigint();
      const originalSend = res.send;
      const originalJson = res.json;
      
      // Track request start
      const requestInfo = {
        method: req.method,
        path: req.route?.path || req.path,
        url: req.originalUrl,
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress,
        startTime: Date.now()
      };
      
      // Override res.send to capture metrics
      res.send = function(data) {
        captureMetrics.call(this, data);
        return originalSend.call(this, data);
      };
      
      // Override res.json to capture metrics
      res.json = function(data) {
        captureMetrics.call(this, data);
        return originalJson.call(this, data);
      };
      
      const captureMetrics = function(data) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        const method = req.method;
        const path = req.route?.path || req.path;
        const key = `${method} ${path}`;
        const statusCode = res.statusCode;
        
        // Record comprehensive metrics
        performanceMonitor.recordRequest(key, duration, statusCode, requestInfo, data);
        
        // Add performance headers for debugging and monitoring
        res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
        res.setHeader('X-Request-ID', req.headers['x-request-id'] || Date.now().toString());
        res.setHeader('X-Cache', res.getHeader('X-Cache') || 'MISS');
        
        // Add compression info if compressed
        if (res.getHeader('Content-Encoding')) {
          res.setHeader('X-Compressed', 'true');
        }
      };
      
      next();
    };
  }

  recordRequest(path, duration, statusCode, requestInfo, responseData) {
    // Update request counts
    this.metrics.requestCounts.set(path, 
      (this.metrics.requestCounts.get(path) || 0) + 1
    );
    
    // Update response times with memory management
    if (!this.metrics.responseTimes.has(path)) {
      this.metrics.responseTimes.set(path, []);
    }
    
    const times = this.metrics.responseTimes.get(path);
    times.push(duration);
    
    // Keep only recent response times to prevent memory bloat
    if (times.length > this.maxResponseTimes) {
      this.metrics.responseTimes.set(path, times.slice(-this.maxResponseTimes));
    }
    
    // Update status code counts
    const statusKey = `${path}:${statusCode}`;
    this.metrics.statusCodes.set(statusKey,
      (this.metrics.statusCodes.get(statusKey) || 0) + 1
    );
    
    // Update error counts for non-2xx responses
    if (statusCode >= 400) {
      this.metrics.errorCounts.set(path,
        (this.metrics.errorCounts.get(path) || 0) + 1
      );
    }
    
    // Track slow requests with detailed information
    if (duration > this.slowThreshold) {
      console.warn(`🐌 SLOW REQUEST: ${path} took ${duration.toFixed(2)}ms [${statusCode}]`);
      
      this.metrics.slowRequests.push({
        path,
        duration: Math.round(duration),
        statusCode,
        timestamp: new Date().toISOString(),
        method: requestInfo.method,
        url: requestInfo.url,
        userAgent: requestInfo.userAgent?.substring(0, 100) || 'unknown',
        ip: requestInfo.ip,
        responseSize: this.estimateResponseSize(responseData)
      });
      
      // Keep only recent slow requests
      if (this.metrics.slowRequests.length > this.maxSlowRequests) {
        this.metrics.slowRequests = this.metrics.slowRequests.slice(-this.maxSlowRequests);
      }
    }
  }

  estimateResponseSize(data) {
    if (!data) return 0;
    if (typeof data === 'string') return data.length;
    if (typeof data === 'object') {
      try {
        return JSON.stringify(data).length;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  getStats() {
    const stats = {};
    
    // Calculate detailed statistics for each endpoint
    for (const [path, times] of this.metrics.responseTimes) {
      const requests = this.metrics.requestCounts.get(path) || 0;
      const errors = this.metrics.errorCounts.get(path) || 0;
      
      if (times.length === 0) continue;
      
      // Calculate statistical measures
      const sorted = [...times].sort((a, b) => a - b);
      const sum = times.reduce((a, b) => a + b, 0);
      const avg = sum / times.length;
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      
      // Calculate percentiles
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      
      // Get status code distribution
      const statusCodes = {};
      for (const [statusKey, count] of this.metrics.statusCodes) {
        if (statusKey.startsWith(path + ':')) {
          const status = statusKey.split(':')[1];
          statusCodes[status] = count;
        }
      }
      
      stats[path] = {
        requests,
        errors,
        errorRate: requests > 0 ? `${(errors / requests * 100).toFixed(2)}%` : '0%',
        responseTimes: {
          avg: Math.round(avg),
          min: Math.round(min),
          max: Math.round(max),
          p50: Math.round(p50),
          p75: Math.round(p75),
          p90: Math.round(p90),
          p95: Math.round(p95),
          p99: Math.round(p99)
        },
        statusCodes,
        performance: this.getPerformanceRating(avg, errors / requests)
      };
    }
    
    // Calculate overall summary
    const totalRequests = Array.from(this.metrics.requestCounts.values()).reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.metrics.errorCounts.values()).reduce((a, b) => a + b, 0);
    const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0;
    
    return {
      endpoints: stats,
      summary: {
        totalRequests,
        totalErrors,
        overallErrorRate: `${overallErrorRate}%`,
        slowRequestCount: this.metrics.slowRequests.length,
        slowThreshold: this.slowThreshold,
        uniqueEndpoints: this.metrics.requestCounts.size,
        monitoringPeriod: this.getMonitoringPeriod()
      },
      slowRequests: this.metrics.slowRequests.slice(-10), // Last 10 slow requests
      topEndpoints: this.getTopEndpoints(5)
    };
  }

  getPerformanceRating(avgResponseTime, errorRate) {
    if (errorRate > 0.05 || avgResponseTime > 2000) return 'poor';
    if (errorRate > 0.01 || avgResponseTime > 1000) return 'fair';
    if (avgResponseTime > 500) return 'good';
    return 'excellent';
  }

  getTopEndpoints(limit = 5) {
    const endpoints = Array.from(this.metrics.requestCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, count]) => ({
        path,
        requests: count,
        avgResponseTime: this.getAverageResponseTime(path),
        errors: this.metrics.errorCounts.get(path) || 0
      }));
    
    return endpoints;
  }

  getAverageResponseTime(path) {
    const times = this.metrics.responseTimes.get(path) || [];
    if (times.length === 0) return 0;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }

  getMonitoringPeriod() {
    const oldestSlowRequest = this.metrics.slowRequests[0];
    if (!oldestSlowRequest) return 'No data';
    
    const start = new Date(oldestSlowRequest.timestamp);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.round(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins} minutes`;
    if (diffMins < 1440) return `${Math.round(diffMins / 60)} hours`;
    return `${Math.round(diffMins / 1440)} days`;
  }

  reset() {
    this.metrics = {
      requestCounts: new Map(),
      responseTimes: new Map(),
      errorCounts: new Map(),
      slowRequests: [],
      statusCodes: new Map()
    };
    console.log('📊 Performance metrics reset');
  }

  getDetailedReport() {
    const stats = this.getStats();
    const memoryUsage = getMemoryStats();
    
    return {
      ...stats,
      system: {
        memory: memoryUsage,
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform
      },
      recommendations: this.generateRecommendations(stats)
    };
  }

  generateRecommendations(stats) {
    const recommendations = [];
    
    // Check for slow endpoints
    for (const [path, data] of Object.entries(stats.endpoints)) {
      if (data.responseTimes.avg > 1000) {
        recommendations.push(`Consider optimizing ${path} - avg response time: ${data.responseTimes.avg}ms`);
      }
      if (parseFloat(data.errorRate) > 5) {
        recommendations.push(`High error rate on ${path}: ${data.errorRate}`);
      }
    }
    
    // Check overall system health
    if (parseFloat(stats.summary.overallErrorRate) > 1) {
      recommendations.push('Overall error rate is elevated - investigate error patterns');
    }
    
    if (stats.summary.slowRequestCount > 50) {
      recommendations.push('High number of slow requests - consider performance optimization');
    }
    
    return recommendations;
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

/**
 * ✅ MEMORY USAGE MONITORING
 * Tracks system memory usage and performance
 */
const getMemoryStats = () => {
  const used = process.memoryUsage();
  const totalMemory = used.rss;
  const heapUsed = used.heapUsed;
  const heapTotal = used.heapTotal;
  const external = used.external;
  
  return {
    rss: Math.round(totalMemory / 1024 / 1024 * 100) / 100, // MB
    heapTotal: Math.round(heapTotal / 1024 / 1024 * 100) / 100, // MB
    heapUsed: Math.round(heapUsed / 1024 / 1024 * 100) / 100, // MB
    heapUsagePercent: Math.round(heapUsed / heapTotal * 100),
    external: Math.round(external / 1024 / 1024 * 100) / 100, // MB
    uptime: Math.round(process.uptime()), // seconds
    uptimeFormatted: formatUptime(process.uptime())
  };
};

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/**
 * ✅ RESPONSE CACHING MIDDLEWARE
 * Cache responses for GET requests that don't change frequently
 */
const responseCacheMiddleware = (ttl = 300000) => { // 5 minutes default
  const cache = new Map();
  const maxCacheSize = 500; // Limit cache size
  
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();
    
    // Don't cache authenticated user-specific data
    const excludePaths = ['/profile', '/me', '/admin', '/health'];
    if (excludePaths.some(path => req.path.includes(path))) {
      return next();
    }
    
    // Create cache key including query parameters
    const cacheKey = `${req.path}:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`📋 Response cache HIT: ${req.path}`);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-TTL', Math.round((ttl - (Date.now() - cached.timestamp)) / 1000));
      res.setHeader('Content-Type', 'application/json');
      return res.status(cached.statusCode).send(cached.data);
    }
    
    // Cache miss - intercept response
    const originalSend = res.send;
    res.send = function(data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        try {
          const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
          if (parsedData.success) {
            console.log(`💾 Response cache MISS: ${req.path} - Caching response`);
            
            // Clean up old cache entries
            if (cache.size >= maxCacheSize) {
              const oldestKey = cache.keys().next().value;
              cache.delete(oldestKey);
            }
            
            cache.set(cacheKey, {
              data: data,
              statusCode: res.statusCode,
              timestamp: Date.now()
            });
            
            res.setHeader('X-Cache', 'MISS');
          }
        } catch (error) {
          // If JSON parsing fails, don't cache
          console.warn('⚠️ Failed to parse response for caching:', error.message);
        }
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = {
  compressionMiddleware,
  performanceMonitor,
  getMemoryStats,
  responseCacheMiddleware
};