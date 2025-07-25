const express = require('express');
const router = express.Router();
const AdvancedAnalyticsController = require('../controllers/analytics-advanced');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// Individual Analytics Routes

// 1. GET /api/analytics-advanced/students/:id - Individual student analytics
router.get('/students/:id',
  AdvancedAnalyticsController.getStudentAnalytics
);

// 2. GET /api/analytics-advanced/courses/:id - Individual course analytics
router.get('/courses/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AdvancedAnalyticsController.getCourseAnalytics
);

// System-wide Analytics Routes

// 3. GET /api/analytics-advanced/exercises - Exercise performance analytics
router.get('/exercises',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AdvancedAnalyticsController.getExerciseAnalytics
);

// 4. GET /api/analytics-advanced/engagement - Engagement trend analysis
router.get('/engagement',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AdvancedAnalyticsController.getEngagementTrends
);

// 5. GET /api/analytics-advanced/completion - Course/lesson completion rates
router.get('/completion',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AdvancedAnalyticsController.getCompletionRates
);

// 6. GET /api/analytics-advanced/revenue - Revenue analytics (admin only)
router.get('/revenue',
  authorizeRoles('super_admin'),
  AdvancedAnalyticsController.getRevenueAnalytics
);

// ✅ Error handling middleware
router.use((error, req, res, next) => {
  console.error('📊 Advanced Analytics route error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  if (error.message.includes('UUID') || error.message.includes('Invalid ID')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      timestamp: new Date().toISOString()
    });
  }

  if (error.message.includes('Date') || error.message.includes('Invalid date')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid date format. Use YYYY-MM-DD',
      timestamp: new Date().toISOString()
    });
  }

  res.status(500).json({
    success: false,
    message: 'Analytics system error',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;