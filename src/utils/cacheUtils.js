// src/utils/cacheUtils.js - Complete Cache Implementation

class QueryCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 1000;
    this.hitCount = 0;
    this.missCount = 0;
    
    // Auto-cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
    
    console.log(`📋 Cache initialized: TTL=${this.ttl/1000}s, MaxSize=${this.maxSize}`);
  }

  createKey(operation, params) {
    // Sort params to ensure consistent cache keys
    const sortedParams = this.sortObject(params || {});
    return `${operation}:${JSON.stringify(sortedParams)}`;
  }

  sortObject(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));
    
    return Object.keys(obj)
      .sort()
      .reduce((result, key) => {
        result[key] = this.sortObject(obj[key]);
        return result;
      }, {});
  }

  async get(key, queryFn) {
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      this.hitCount++;
      cached.accessCount++;
      console.log(`📋 Cache HIT: ${key.substring(0, 50)}...`);
      return cached.data;
    }
    
    // Cache miss - execute query
    this.missCount++;
    console.log(`💾 Cache MISS: ${key.substring(0, 50)}...`);
    
    try {
      const data = await queryFn();
      this.set(key, data);
      return data;
    } catch (error) {
      console.error(`❌ Cache query failed for key: ${key.substring(0, 50)}...`, error.message);
      throw error;
    }
  }

  set(key, data) {
    // Cleanup if approaching max size
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1
    });
  }

  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      console.log(`🗑️ Cache entry deleted: ${key.substring(0, 50)}...`);
    }
    return deleted;
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    console.log(`🗑️ Cache cleared: ${size} entries removed`);
  }

  evictOldest() {
    // Find least recently used entry
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`🗑️ Evicted oldest cache entry: ${oldestKey.substring(0, 50)}...`);
    }
  }

  cleanup() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttl) {
        expiredKeys.push(key);
      }
    }
    
    expiredKeys.forEach(key => this.cache.delete(key));
    
    if (expiredKeys.length > 0) {
      console.log(`🧹 Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  getStats() {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests * 100).toFixed(2) : 0;
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: `${hitRate}%`,
      ttlSeconds: this.ttl / 1000,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  estimateMemoryUsage() {
    // Rough estimate of memory usage in MB
    const avgEntrySize = 1024; // Assume 1KB per entry on average
    return Math.round(this.cache.size * avgEntrySize / 1024 / 1024 * 100) / 100;
  }

  // Invalidate cache entries by pattern
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🗑️ Invalidated ${keysToDelete.length} cache entries matching pattern: ${pattern}`);
    }
    
    return keysToDelete.length;
  }

  // Get cache entries for debugging
  getEntries(limit = 10) {
    const entries = [];
    let count = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (count >= limit) break;
      
      entries.push({
        key: key.substring(0, 100) + (key.length > 100 ? '...' : ''),
        timestamp: new Date(value.timestamp).toISOString(),
        accessCount: value.accessCount,
        ageSeconds: Math.round((Date.now() - value.timestamp) / 1000)
      });
      
      count++;
    }
    
    return entries;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
    console.log('🗑️ Cache destroyed and cleanup interval cleared');
  }
}

// Create singleton instances for different cache types
const queryCache = new QueryCache({ 
  ttl: 5 * 60 * 1000,  // 5 minutes for general queries
  maxSize: 1000 
});

const statsCache = new QueryCache({ 
  ttl: 2 * 60 * 1000,  // 2 minutes for stats (they change more frequently)
  maxSize: 500 
});

const publicCache = new QueryCache({ 
  ttl: 10 * 60 * 1000, // 10 minutes for public data (categories, etc.)
  maxSize: 200 
});

// Export both class and instances
module.exports = {
  QueryCache,
  queryCache,
  statsCache,
  publicCache
};