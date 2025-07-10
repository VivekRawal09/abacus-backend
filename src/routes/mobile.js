const express = require('express');
const router = express.Router();
const MobileController = require('../controllers/mobile');
const { 
  authenticateToken, 
  authorizeRoles, 
  validateDataScope 
} = require('../middleware/auth');
const { 
  mobileMiddlewareStack,
  mobileRateLimit,
  appVersionCheck 
} = require('../middleware/mobile');

// ✅ MOBILE ROUTES - Optimized for React Native Integration

// ========================================
// AUTHENTICATION & TOKEN MANAGEMENT
// ========================================

// 1. POST /api/mobile/auth/refresh - Refresh mobile authentication token
router.post('/auth/refresh', 
  // No auth required for refresh endpoint
  (req, res, next) => {
    // ✅ VALIDATION: Refresh token format
    const { refresh_token } = req.body;
    
    if (!refresh_token || typeof refresh_token !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Valid refresh token is required'
      });
    }
    
    // ✅ SECURITY: Log refresh attempts
    console.log('📱 Mobile token refresh attempt:', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      appVersion: req.headers['x-app-version'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();``
  },
  MobileController.refreshToken
);

// ========================================
// USER PROFILE & PREFERENCES
// ========================================

// Apply authentication to all routes below
router.use(authenticateToken);
router.use(mobileMiddlewareStack);

// 2. GET /api/mobile/user/profile - Get mobile-optimized user profile
router.get('/user/profile',
  // All authenticated users can access their own profile
  (req, res, next) => {
    // ✅ MOBILE ANALYTICS: Log profile access
    console.log('📱 Mobile profile access:', {
      userId: req.user.id,
      role: req.user.role,
      appVersion: req.headers['x-app-version'] || 'unknown',
      deviceOS: req.headers['x-device-os'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    next();
  },
  MobileController.getUserProfile
);

// 3. PUT /api/mobile/user/profile - Update user profile from mobile
router.put('/user/profile',
  // ✅ VALIDATION: Profile update data
  (req, res, next) => {
    const { first_name, last_name, date_of_birth, grade_level } = req.body;
    
    // Validate name fields if provided
    if (first_name && (typeof first_name !== 'string' || first_name.trim().length < 2)) {
      return res.status(400).json({
        success: false,
        message: 'First name must be at least 2 characters'
      });
    }
    
    if (last_name && (typeof last_name !== 'string' || last_name.trim().length < 2)) {
      return res.status(400).json({
        success: false,
        message: 'Last name must be at least 2 characters'
      });
    }
    
    // Validate date of birth if provided
    if (date_of_birth) {
      const dobDate = new Date(date_of_birth);
      const currentDate = new Date();
      const age = currentDate.getFullYear() - dobDate.getFullYear();
      
      if (isNaN(dobDate.getTime()) || age < 3 || age > 25) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid date of birth (age between 3-25)'
        });
      }
    }
    
    // Validate grade level if provided
    if (grade_level && (typeof grade_level !== 'string' || !['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].includes(grade_level))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid grade level'
      });
    }
    
    // ✅ SECURITY: Log profile updates
    console.log('📱 Mobile profile update attempt:', {
      userId: req.user.id,
      fields: Object.keys(req.body),
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.updateUserProfile
);

// 4. GET /api/mobile/user/preferences - Get mobile app user preferences
router.get('/user/preferences',
  MobileController.getUserPreferences
);

// 5. PUT /api/mobile/user/preferences - Update mobile app preferences
router.put('/user/preferences',
  // ✅ VALIDATION: Preferences data
  (req, res, next) => {
    const { app_settings, notifications, abacus_settings, exercise_settings } = req.body;
    
    // Validate app settings if provided
    if (app_settings) {
      if (app_settings.theme && !['light', 'dark', 'auto'].includes(app_settings.theme)) {
        return res.status(400).json({
          success: false,
          message: 'Theme must be one of: light, dark, auto'
        });
      }
      
      if (app_settings.language && !['en', 'hi', 'es', 'fr'].includes(app_settings.language)) {
        return res.status(400).json({
          success: false,
          message: 'Unsupported language'
        });
      }
      
      if (app_settings.video_quality && !['auto', '360p', '480p', '720p'].includes(app_settings.video_quality)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video quality setting'
        });
      }
    }
    
    // Validate ABACUS settings if provided
    if (abacus_settings) {
      if (abacus_settings.bead_color && !['brown', 'red', 'blue', 'green', 'black'].includes(abacus_settings.bead_color)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid bead color'
        });
      }
      
      if (abacus_settings.animation_speed && !['slow', 'normal', 'fast'].includes(abacus_settings.animation_speed)) {
        return res.status(400).json({
          success: false,
          message: 'Animation speed must be slow, normal, or fast'
        });
      }
    }
    
    next();
  },
  MobileController.updateUserPreferences
);

// ========================================
// LESSON MANAGEMENT
// ========================================

// 6. GET /api/mobile/lessons/:id/details - Lesson details for mobile
router.get('/lessons/:id/details',
  // ✅ VALIDATION: UUID format for lesson ID
  (req, res, next) => {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson ID format'
      });
    }
    
    next();
  },
  MobileController.getLessonDetails
);

// 7. POST /api/mobile/lessons/:id/start - Start lesson on mobile
router.post('/lessons/:id/start',
  // ✅ AUTHORIZATION: Only students can start lessons
  authorizeRoles('student'),
  // ✅ VALIDATION: UUID format
  (req, res, next) => {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson ID format'
      });
    }
    
    // ✅ MOBILE ANALYTICS: Log lesson start
    console.log('📱 Mobile lesson start:', {
      userId: req.user.id,
      lessonId: id,
      deviceOS: req.headers['x-device-os'] || 'unknown',
      appVersion: req.headers['x-app-version'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.startLesson
);

// 8. PUT /api/mobile/lessons/:id/complete - Complete lesson on mobile
router.put('/lessons/:id/complete',
  // ✅ AUTHORIZATION: Only students can complete lessons
  authorizeRoles('student'),
  // ✅ VALIDATION: UUID format and completion data
  (req, res, next) => {
    const { id } = req.params;
    const { score, time_spent_minutes } = req.body;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson ID format'
      });
    }
    
    // Validate score if provided
    if (score !== undefined && (typeof score !== 'number' || score < 0 || score > 1000)) {
      return res.status(400).json({
        success: false,
        message: 'Score must be a number between 0 and 1000'
      });
    }
    
    // Validate time spent if provided
    if (time_spent_minutes !== undefined && (typeof time_spent_minutes !== 'number' || time_spent_minutes < 0 || time_spent_minutes > 300)) {
      return res.status(400).json({
        success: false,
        message: 'Time spent must be between 0 and 300 minutes'
      });
    }
    
    // ✅ MOBILE ANALYTICS: Log lesson completion
    console.log('📱 Mobile lesson completion:', {
      userId: req.user.id,
      lessonId: id,
      score: score || 0,
      timeSpent: time_spent_minutes || 0,
      deviceOS: req.headers['x-device-os'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.completeLesson
);

// ========================================
// VIDEO MANAGEMENT
// ========================================

// 9. GET /api/mobile/videos/:id/stream - Video streaming optimized for mobile
router.get('/videos/:id/stream',
  // ✅ VALIDATION: UUID format for video ID
  (req, res, next) => {
    const { id } = req.params;
    const { quality } = req.query;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }
    
    // Validate quality parameter if provided
    if (quality && !['auto', '360p', '480p', '720p', '1080p'].includes(quality)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video quality. Supported: auto, 360p, 480p, 720p, 1080p'
      });
    }
    
    // ✅ MOBILE ANALYTICS: Log video access
    console.log('📱 Mobile video access:', {
      userId: req.user.id,
      videoId: id,
      requestedQuality: quality || 'auto',
      deviceOS: req.headers['x-device-os'] || 'unknown',
      connectionType: req.headers['x-connection-type'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.getVideoStream
);

// 10. POST /api/mobile/videos/:id/bookmark - Bookmark video in mobile app
router.post('/videos/:id/bookmark',
  // ✅ VALIDATION: UUID format and bookmark data
  (req, res, next) => {
    const { id } = req.params;
    const { timestamp, note } = req.body;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }
    
    // Validate timestamp
    if (timestamp !== undefined && (typeof timestamp !== 'number' || timestamp < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Timestamp must be a positive number (seconds)'
      });
    }
    
    // Validate note if provided
    if (note && (typeof note !== 'string' || note.length > 500)) {
      return res.status(400).json({
        success: false,
        message: 'Note must be a string with max 500 characters'
      });
    }
    
    next();
  },
  MobileController.bookmarkVideo
);

// 11. GET /api/mobile/videos/:id/bookmarks - Get video bookmarks
router.get('/videos/:id/bookmarks',
  // ✅ VALIDATION: UUID format for video ID
  (req, res, next) => {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }
    
    next();
  },
  MobileController.getVideoBookmarks
);

// ========================================
// ANALYTICS & ACTIVITY
// ========================================

// 12. GET /api/mobile/exercises/history/:student_id - Exercise history for mobile
router.get('/exercises/history/:student_id',
  // ✅ AUTHORIZATION: Students can only access their own history
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // ✅ VALIDATION: UUID format and pagination
  (req, res, next) => {
    const { student_id } = req.params;
    const { limit, offset } = req.query;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(student_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }
    
    // Validate pagination parameters
    if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100'
      });
    }
    
    if (offset && (isNaN(offset) || parseInt(offset) < 0)) {
      return res.status(400).json({
        success: false,
        message: 'Offset must be a non-negative number'
      });
    }
    
    next();
  },
  MobileController.getExerciseHistory
);

// 13. POST /api/mobile/activity-log - Log detailed mobile app activity
router.post('/activity-log',
  // ✅ VALIDATION: Activity log data
  (req, res, next) => {
    const { action, entity_type, entity_id, details, timestamp } = req.body;
    
    // Required fields validation
    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Action is required and must be a non-empty string'
      });
    }
    
    if (!entity_type || typeof entity_type !== 'string' || entity_type.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Entity type is required and must be a non-empty string'
      });
    }
    
    // Validate action format (alphanumeric, underscores, hyphens)
    if (!/^[a-zA-Z0-9_-]+$/.test(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must contain only letters, numbers, underscores, and hyphens'
      });
    }
    
    // Validate entity_id if provided (should be UUID for most entities)
    if (entity_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(entity_id)) {
        return res.status(400).json({
          success: false,
          message: 'Entity ID must be a valid UUID'
        });
      }
    }
    
    // Validate timestamp if provided
    if (timestamp) {
      const timestampDate = new Date(timestamp);
      if (isNaN(timestampDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid timestamp format'
        });
      }
    }
    
    // Validate details size (prevent large payloads)
    if (details && JSON.stringify(details).length > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Activity details too large (max 10KB)'
      });
    }
    
    // ✅ SECURITY: Rate limiting for activity logs
    const now = Date.now();
    const logKey = `activity_log_${req.user.id}`;
    
    if (!req.app.locals.activityLogAttempts) {
      req.app.locals.activityLogAttempts = new Map();
    }
    
    const lastLog = req.app.locals.activityLogAttempts.get(logKey);
    if (lastLog && (now - lastLog) < 1000) { // 1 second cooldown
      return res.status(429).json({
        success: false,
        message: 'Activity logging rate limit exceeded'
      });
    }
    
    req.app.locals.activityLogAttempts.set(logKey, now);
    
    // ✅ MOBILE ANALYTICS: Enhanced logging
    console.log('📱 Mobile activity logged:', {
      userId: req.user.id,
      action,
      entityType: entity_type,
      deviceOS: req.headers['x-device-os'] || 'unknown',
      appVersion: req.headers['x-app-version'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.logActivity
);

// ========================================
// SUPPORT SYSTEM
// ========================================

// 14. GET /api/mobile/support/faq - FAQ content for mobile app
router.get('/support/faq',
  // ✅ VALIDATION: FAQ query parameters
  (req, res, next) => {
    const { category, language } = req.query;
    
    // Validate category if provided
    if (category && !['general', 'technical', 'account', 'courses', 'billing'].includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid FAQ category. Supported: general, technical, account, courses, billing'
      });
    }
    
    // Validate language if provided
    if (language && !['en', 'hi', 'es', 'fr'].includes(language)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported language. Available: en, hi, es, fr'
      });
    }
    
    next();
  },
  MobileController.getSupportFAQ
);

// 15. POST /api/mobile/support/ticket - Create support ticket from mobile
router.post('/support/ticket',
  // ✅ VALIDATION: Support ticket data
  (req, res, next) => {
    const { subject, description, category, priority, device_info } = req.body;
    
    // Required fields validation
    if (!subject || typeof subject !== 'string' || subject.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Subject is required and must be at least 5 characters'
      });
    }
    
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Description is required and must be at least 10 characters'
      });
    }
    
    // Validate subject and description length
    if (subject.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Subject must be less than 200 characters'
      });
    }
    
    if (description.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Description must be less than 5000 characters'
      });
    }
    
    // Validate category if provided
    if (category && !['general', 'technical', 'account', 'billing', 'content', 'bug_report', 'feature_request'].includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category'
      });
    }
    
    // Validate priority if provided
    if (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be one of: low, medium, high, urgent'
      });
    }
    
    // ✅ SECURITY: Rate limiting for support tickets
    const now = Date.now();
    const ticketKey = `support_ticket_${req.user.id}`;
    
    if (!req.app.locals.supportTicketAttempts) {
      req.app.locals.supportTicketAttempts = new Map();
    }
    
    const lastTicket = req.app.locals.supportTicketAttempts.get(ticketKey);
    if (lastTicket && (now - lastTicket) < 300000) { // 5 minute cooldown
      return res.status(429).json({
        success: false,
        message: 'Please wait 5 minutes before creating another support ticket'
      });
    }
    
    req.app.locals.supportTicketAttempts.set(ticketKey, now);
    
    // ✅ MOBILE ANALYTICS: Log support ticket creation
    console.log('📱 Mobile support ticket:', {
      userId: req.user.id,
      subject: subject.substring(0, 50) + '...',
      category: category || 'general',
      priority: priority || 'medium',
      deviceOS: req.headers['x-device-os'] || 'unknown',
      appVersion: req.headers['x-app-version'] || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  MobileController.createSupportTicket
);

// ========================================
// ERROR HANDLING & CLEANUP
// ========================================

// ✅ ENHANCED: Error handling middleware
router.use((error, req, res, next) => {
  // Log all mobile errors for analytics
  console.error('📱 Mobile route error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    userRole: req.user?.role,
    path: req.path,
    method: req.method,
    deviceOS: req.headers['x-device-os'] || 'unknown',
    appVersion: req.headers['x-app-version'] || 'unknown',
    body: req.method !== 'GET' ? req.body : undefined,
    timestamp: new Date().toISOString()
  });

  // Handle specific mobile error types
  if (error.message.includes('UUID') || error.message.includes('Invalid ID')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid resource ID format',
      errorCode: 'INVALID_ID'
    });
  }

  if (error.message.includes('Authentication required') || error.message.includes('token')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed',
      errorCode: 'AUTH_FAILED'
    });
  }

  if (error.message.includes('Insufficient permissions') || error.message.includes('Access denied')) {
    return res.status(403).json({
      success: false,
      message: 'Access denied',
      errorCode: 'ACCESS_DENIED'
    });
  }

  if (error.message.includes('not found')) {
    return res.status(404).json({
      success: false,
      message: 'Resource not found',
      errorCode: 'NOT_FOUND'
    });
  }

  if (error.message.includes('rate limit')) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded',
      errorCode: 'RATE_LIMITED'
    });
  }

  // Generic mobile error handling
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});

// ✅ CATCH-ALL: Handle undefined mobile routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Mobile API endpoint not found',
    available_endpoints: [
      'POST /api/mobile/auth/refresh',
      'GET /api/mobile/user/profile',
      'PUT /api/mobile/user/profile',
      'GET /api/mobile/user/preferences',
      'PUT /api/mobile/user/preferences',
      'GET /api/mobile/lessons/:id/details',
      'POST /api/mobile/lessons/:id/start',
      'PUT /api/mobile/lessons/:id/complete',
      'GET /api/mobile/videos/:id/stream',
      'POST /api/mobile/videos/:id/bookmark',
      'GET /api/mobile/videos/:id/bookmarks',
      'GET /api/mobile/exercises/history/:student_id',
      'POST /api/mobile/activity-log',
      'GET /api/mobile/support/faq',
      'POST /api/mobile/support/ticket'
    ],
    mobile_features: {
      authentication: '✅ Token refresh',
      profile_management: '✅ User profile & preferences',
      learning: '✅ Lesson tracking & progress',
      media: '✅ Video streaming & bookmarks',
      analytics: '✅ Activity logging & history',
      support: '✅ FAQ & ticket system'
    },
    timestamp: new Date().toISOString()
  });
});

// ✅ CLEANUP: Periodic cleanup of rate limiting data
setInterval(() => {
  const now = Date.now();
  const cutoff = 30 * 60 * 1000; // 30 minutes
  
  // Cleanup activity log rate limiting
  if (router.app && router.app.locals.activityLogAttempts) {
    for (const [key, timestamp] of router.app.locals.activityLogAttempts.entries()) {
      if (now - timestamp > cutoff) {
        router.app.locals.activityLogAttempts.delete(key);
      }
    }
  }
  
  // Cleanup support ticket rate limiting
  if (router.app && router.app.locals.supportTicketAttempts) {
    for (const [key, timestamp] of router.app.locals.supportTicketAttempts.entries()) {
      if (now - timestamp > cutoff) {
        router.app.locals.supportTicketAttempts.delete(key);
      }
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

module.exports = router;