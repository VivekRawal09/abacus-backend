const { supabase } = require('../config/database');
const jwt = require('jsonwebtoken');

// ✅ MOBILE MIDDLEWARE - Enhanced for React Native Integration

// ================================================
// 1. DEVICE DETECTION & FINGERPRINTING
// ================================================

const deviceDetection = (req, res, next) => {
  try {
    // Extract device information from headers
    const deviceInfo = {
      // Standard mobile headers
      platform: req.headers['x-device-platform'] || 'unknown', // ios, android
      os_version: req.headers['x-device-os'] || req.headers['x-os-version'] || 'unknown',
      app_version: req.headers['x-app-version'] || req.headers['x-version'] || 'unknown',
      device_model: req.headers['x-device-model'] || 'unknown',
      device_id: req.headers['x-device-id'] || req.headers['x-device-uuid'] || null,
      
      // Network and performance
      network_type: req.headers['x-network-type'] || req.headers['x-connection-type'] || 'unknown', // wifi, cellular, 4g, 5g
      screen_density: req.headers['x-screen-density'] || 'unknown',
      screen_resolution: req.headers['x-screen-resolution'] || 'unknown',
      
      // App state and context
      app_build: req.headers['x-app-build'] || req.headers['x-build-number'] || 'unknown',
      bundle_id: req.headers['x-bundle-id'] || req.headers['x-package-name'] || 'unknown',
      locale: req.headers['x-device-locale'] || req.headers['accept-language'] || 'en',
      timezone: req.headers['x-timezone'] || 'unknown',
      
      // Additional context
      user_agent: req.headers['user-agent'] || 'unknown',
      ip_address: req.ip || req.connection.remoteAddress || 'unknown',
      
      // Performance indicators
      battery_level: req.headers['x-battery-level'] || null,
      memory_usage: req.headers['x-memory-usage'] || null,
      storage_available: req.headers['x-storage-available'] || null
    };

    // Detect if this is a mobile request
    const isMobileRequest = deviceInfo.platform === 'ios' || 
                          deviceInfo.platform === 'android' ||
                          req.path.startsWith('/api/mobile/') ||
                          req.headers['x-requested-with'] === 'mobile-app';

    // Add device info to request for use in controllers
    req.deviceInfo = deviceInfo;
    req.isMobile = isMobileRequest;

    // ✅ MOBILE ANALYTICS: Log device detection
    if (isMobileRequest) {
      console.log('📱 Mobile device detected:', {
        platform: deviceInfo.platform,
        app_version: deviceInfo.app_version,
        device_model: deviceInfo.device_model,
        network_type: deviceInfo.network_type,
        endpoint: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    }

    next();

  } catch (error) {
    console.error('Device detection error:', error);
    // Continue without device info rather than blocking request
    req.deviceInfo = { platform: 'unknown' };
    req.isMobile = false;
    next();
  }
};

// ================================================
// 2. MOBILE SESSION MANAGEMENT
// ================================================

const mobileSessionManager = async (req, res, next) => {
  try {
    // Only process mobile requests with authentication
    if (!req.isMobile || !req.user || !req.deviceInfo.device_id) {
      return next();
    }

    const userId = req.user.id;
    const deviceId = req.deviceInfo.device_id;

    // Check if mobile session exists for this user/device
    const { data: existingSession, error: sessionError } = await supabase
      .from('mobile_sessions')
      .select('id, session_token, is_active, last_activity')
      .eq('user_id', userId)
      .eq('device_info->device_id', deviceId)
      .eq('is_active', true)
      .single();

    if (sessionError && sessionError.code !== 'PGRST116') {
      console.error('Mobile session query error:', sessionError);
      return next(); // Continue without session management
    }

    let sessionId = null;

    if (existingSession) {
      // Update existing session
      const { data: updatedSession, error: updateError } = await supabase
        .from('mobile_sessions')
        .update({
          last_activity: new Date().toISOString(),
          activities_count: supabase.raw('activities_count + 1'),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingSession.id)
        .select('id')
        .single();

      if (!updateError) {
        sessionId = updatedSession.id;
      }
    } else {
      // Create new mobile session
      const sessionToken = `mobile_${userId}_${deviceId}_${Date.now()}`;
      
      const { data: newSession, error: createError } = await supabase
        .from('mobile_sessions')
        .insert([{
          user_id: userId,
          session_token: sessionToken,
          device_info: req.deviceInfo,
          app_version: req.deviceInfo.app_version,
          started_at: new Date().toISOString(),
          last_activity: new Date().toISOString(),
          is_active: true,
          activities_count: 1
        }])
        .select('id')
        .single();

      if (!createError) {
        sessionId = newSession.id;
        
        // ✅ MOBILE ANALYTICS: Log new session
        console.log('📱 New mobile session created:', {
          userId,
          deviceId,
          platform: req.deviceInfo.platform,
          app_version: req.deviceInfo.app_version,
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Add session ID to request for activity logging
    req.mobileSessionId = sessionId;
    next();

  } catch (error) {
    console.error('Mobile session management error:', error);
    next(); // Continue without session management
  }
};

// ================================================
// 3. MOBILE ACTIVITY LOGGER
// ================================================

const mobileActivityLogger = async (req, res, next) => {
  // Store original res.json to capture response data
  const originalJson = res.json;
  const startTime = Date.now();

  res.json = function(data) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Log mobile activity asynchronously (don't block response)
    if (req.isMobile && req.user) {
      setImmediate(async () => {
        try {
          const activityData = {
            user_id: req.user.id,
            action: `${req.method.toLowerCase()}_${req.path.replace('/api/mobile/', '').replace(/[/:]/g, '_')}`,
            entity_type: 'mobile_endpoint',
            entity_id: null,
            details: {
              endpoint: req.path,
              method: req.method,
              response_time_ms: responseTime,
              response_status: res.statusCode,
              success: data?.success || false,
              query_params: Object.keys(req.query).length > 0 ? req.query : null,
              body_size: req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0,
              response_size: JSON.stringify(data).length,
              
              // Mobile-specific context
              screen_name: req.headers['x-screen-name'] || null,
              session_duration: req.headers['x-session-duration'] || null,
              user_action: req.headers['x-user-action'] || null,
              
              // Performance metrics
              network_type: req.deviceInfo?.network_type,
              battery_level: req.deviceInfo?.battery_level,
              memory_usage: req.deviceInfo?.memory_usage
            },
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            platform: 'mobile',
            
            // Mobile-specific columns
            app_version: req.deviceInfo?.app_version,
            device_os: req.deviceInfo?.platform,
            device_model: req.deviceInfo?.device_model,
            network_type: req.deviceInfo?.network_type
          };

          // Insert activity log
          await supabase
            .from('activity_logs')
            .insert([activityData]);

          // ✅ MOBILE ANALYTICS: Log significant activities
          if (responseTime > 5000 || res.statusCode >= 400) {
            console.log('📱 Mobile activity logged:', {
              action: activityData.action,
              responseTime: `${responseTime}ms`,
              status: res.statusCode,
              success: data?.success || false,
              userId: req.user.id,
              platform: req.deviceInfo?.platform,
              endpoint: req.path
            });
          }

        } catch (error) {
          console.error('Mobile activity logging error:', error);
        }
      });
    }

    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

// ================================================
// 4. MOBILE RATE LIMITING
// ================================================

// Enhanced rate limiting for mobile endpoints
const mobileRateLimit = (options = {}) => {
  const {
    windowMs = 60000, // 1 minute
    maxRequests = 100, // requests per window
    skipSuccessfulRequests = false,
    message = 'Too many requests from mobile app'
  } = options;

  // In-memory store for rate limiting (consider Redis for production)
  const requests = new Map();

  return (req, res, next) => {
    if (!req.isMobile) {
      return next(); // Skip rate limiting for non-mobile requests
    }

    const identifier = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    if (requests.has(identifier)) {
      const userRequests = requests.get(identifier);
      const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
      requests.set(identifier, validRequests);
    }

    // Get current request count
    const currentRequests = requests.get(identifier) || [];
    
    // Check if limit exceeded
    if (currentRequests.length >= maxRequests) {
      // ✅ MOBILE ANALYTICS: Log rate limit exceeded
      console.log('📱 Mobile rate limit exceeded:', {
        identifier,
        requestCount: currentRequests.length,
        limit: maxRequests,
        endpoint: req.path,
        platform: req.deviceInfo?.platform,
        timestamp: new Date().toISOString()
      });

      return res.status(429).json({
        success: false,
        message,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(windowMs / 1000),
        limit: maxRequests,
        remaining: 0,
        resetTime: new Date(now + windowMs).toISOString()
      });
    }

    // Add current request
    currentRequests.push(now);
    requests.set(identifier, currentRequests);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - currentRequests.length);
    res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));

    next();
  };
};

// ================================================
// 5. APP VERSION COMPATIBILITY
// ================================================

const appVersionCheck = (options = {}) => {
  const {
    minVersion = '1.0.0',
    deprecatedVersions = [],
    blockedVersions = []
  } = options;

  return (req, res, next) => {
    if (!req.isMobile) {
      return next();
    }

    const appVersion = req.deviceInfo?.app_version || '0.0.0';

    // Check if version is blocked
    if (blockedVersions.includes(appVersion)) {
      return res.status(426).json({
        success: false,
        message: 'App version is no longer supported. Please update your app.',
        errorCode: 'APP_VERSION_BLOCKED',
        currentVersion: appVersion,
        minimumVersion: minVersion,
        updateRequired: true
      });
    }

    // Check if version is deprecated
    if (deprecatedVersions.includes(appVersion)) {
      res.setHeader('X-App-Version-Deprecated', 'true');
      res.setHeader('X-App-Update-Available', 'true');
    }

    // Check minimum version
    if (compareVersions(appVersion, minVersion) < 0) {
      return res.status(426).json({
        success: false,
        message: 'App version is too old. Please update your app.',
        errorCode: 'APP_VERSION_TOO_OLD',
        currentVersion: appVersion,
        minimumVersion: minVersion,
        updateRequired: true
      });
    }

    next();
  };
};

// Version comparison utility
function compareVersions(version1, version2) {
  const v1parts = version1.split('.').map(Number);
  const v2parts = version2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
    const v1part = v1parts[i] || 0;
    const v2part = v2parts[i] || 0;
    
    if (v1part < v2part) return -1;
    if (v1part > v2part) return 1;
  }
  
  return 0;
}

// ================================================
// 6. MOBILE RESPONSE OPTIMIZATION
// ================================================

const mobileResponseOptimizer = (req, res, next) => {
  // Store original res.json
  const originalJson = res.json;

  res.json = function(data) {
    if (req.isMobile) {
      // Add mobile-specific response headers
      res.setHeader('X-Mobile-Optimized', 'true');
      res.setHeader('X-Response-Time', Date.now() - req.startTime);
      
      // Add caching headers for mobile
      if (req.method === 'GET' && data?.success) {
        res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
      }

      // Add offline sync indicators
      res.setHeader('X-Sync-Timestamp', new Date().toISOString());
      res.setHeader('X-Data-Version', Date.now().toString());

      // Compress large responses for mobile
      if (JSON.stringify(data).length > 10000) {
        res.setHeader('X-Large-Response', 'true');
      }

      // Add network-aware hints
      if (req.deviceInfo?.network_type === 'cellular') {
        res.setHeader('X-Data-Saver', 'recommended');
      }
    }

    return originalJson.call(this, data);
  };

  // Track request start time
  req.startTime = Date.now();
  next();
};

// ================================================
// 7. MOBILE ERROR HANDLER
// ================================================

const mobileErrorHandler = (error, req, res, next) => {
  // Enhanced error handling for mobile apps
  if (req.isMobile) {
    console.error('📱 Mobile API Error:', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      userId: req.user?.id,
      deviceInfo: {
        platform: req.deviceInfo?.platform,
        app_version: req.deviceInfo?.app_version,
        device_model: req.deviceInfo?.device_model
      },
      request: {
        path: req.path,
        method: req.method,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-app-version': req.headers['x-app-version'],
          'x-device-platform': req.headers['x-device-platform']
        }
      },
      timestamp: new Date().toISOString()
    });

    // Mobile-specific error response format
    const mobileErrorResponse = {
      success: false,
      errorCode: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
      
      // Mobile-specific error context
      mobile: {
        canRetry: isRetryableError(error),
        offlineCapable: isOfflineCapableEndpoint(req.path),
        supportContact: 'help@abacuslearn.com'
      }
    };

    // Add debug info in development
    if (process.env.NODE_ENV === 'development') {
      mobileErrorResponse.debug = {
        stack: error.stack,
        deviceInfo: req.deviceInfo
      };
    }

    // Determine appropriate status code
    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('unauthorized') || error.message.includes('token')) statusCode = 401;
    if (error.message.includes('forbidden') || error.message.includes('permission')) statusCode = 403;
    if (error.message.includes('validation') || error.message.includes('invalid')) statusCode = 400;
    if (error.message.includes('rate limit')) statusCode = 429;

    return res.status(statusCode).json(mobileErrorResponse);
  }

  // Pass to default error handler for non-mobile requests
  next(error);
};

// Helper functions for mobile error handler
function isRetryableError(error) {
  const retryableErrors = [
    'network error',
    'timeout',
    'connection reset',
    'temporary failure',
    'service unavailable'
  ];
  
  return retryableErrors.some(retryable => 
    error.message.toLowerCase().includes(retryable)
  );
}

function isOfflineCapableEndpoint(path) {
  const offlineCapable = [
    '/api/mobile/user/profile',
    '/api/mobile/user/preferences',
    '/api/mobile/lessons/',
    '/api/mobile/courses/',
    '/api/mobile/support/faq'
  ];
  
  return offlineCapable.some(endpoint => path.includes(endpoint));
}

// ================================================
// 8. MOBILE SECURITY HEADERS
// ================================================

const mobileSecurityHeaders = (req, res, next) => {
  if (req.isMobile) {
    // Mobile-specific security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Mobile app security
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-Download-Options', 'noopen');
    
    // Prevent MIME type sniffing
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    
    // Add mobile-specific CORS headers if needed
    if (req.headers.origin && req.headers.origin.includes('mobile-app')) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  
  next();
};

// ================================================
// 9. MOBILE ANALYTICS AGGREGATOR
// ================================================

const mobileAnalyticsAggregator = {
  // Aggregate daily mobile analytics
  aggregateDailyStats: async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get mobile session stats for today
      const { data: sessionStats, error: sessionError } = await supabase
        .rpc('get_daily_mobile_stats', { target_date: today });

      if (sessionError) {
        console.error('Mobile analytics aggregation error:', sessionError);
        return;
      }

      // Insert or update daily analytics
      for (const stat of sessionStats || []) {
        await supabase
          .from('mobile_analytics_daily')
          .upsert({
            date: today,
            platform: stat.platform,
            app_version: stat.app_version,
            total_sessions: stat.session_count,
            unique_users: stat.unique_users,
            avg_session_duration: stat.avg_duration,
            total_activities: stat.total_activities,
            lessons_started: stat.lessons_started,
            lessons_completed: stat.lessons_completed,
            videos_watched: stat.videos_watched,
            exercise_sessions: stat.exercises,
            support_tickets: stat.support_tickets
          });
      }

      console.log(`📊 Mobile analytics aggregated for ${today}`);

    } catch (error) {
      console.error('Mobile analytics aggregation error:', error);
    }
  }
};

// ================================================
// 10. CLEANUP UTILITIES
// ================================================

// Cleanup old mobile sessions and data
const mobileCleanup = {
  cleanupSessions: async () => {
    try {
      // Mark sessions inactive after 30 days of inactivity
      const { data, error } = await supabase
        .from('mobile_sessions')
        .update({ 
          is_active: false, 
          ended_at: new Date().toISOString() 
        })
        .lt('last_activity', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .eq('is_active', true);

      if (!error) {
        console.log(`🧹 Cleaned up ${data?.length || 0} inactive mobile sessions`);
      }
    } catch (error) {
      console.error('Mobile session cleanup error:', error);
    }
  },

  cleanupOldActivityLogs: async () => {
    try {
      // Delete mobile activity logs older than 90 days
      const { data, error } = await supabase
        .from('activity_logs')
        .delete()
        .lt('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .eq('platform', 'mobile');

      if (!error) {
        console.log(`🧹 Cleaned up ${data?.length || 0} old mobile activity logs`);
      }
    } catch (error) {
      console.error('Mobile activity logs cleanup error:', error);
    }
  }
};

// Schedule cleanup tasks (run daily)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    mobileCleanup.cleanupSessions();
    mobileCleanup.cleanupOldActivityLogs();
    mobileAnalyticsAggregator.aggregateDailyStats();
  }, 24 * 60 * 60 * 1000); // Every 24 hours
}

// ================================================
// EXPORTS
// ================================================

module.exports = {
  // Core mobile middleware
  deviceDetection,
  mobileSessionManager,
  mobileActivityLogger,
  mobileResponseOptimizer,
  mobileErrorHandler,
  mobileSecurityHeaders,
  
  // Security and performance
  mobileRateLimit,
  appVersionCheck,
  
  // Utilities
  mobileAnalyticsAggregator,
  mobileCleanup,
  
  // Composite middleware stack for mobile routes
  mobileMiddlewareStack: [
    deviceDetection,
    mobileSecurityHeaders,
    mobileResponseOptimizer,
    mobileSessionManager,
    mobileActivityLogger
  ]
};