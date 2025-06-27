const express = require('express');
const router = express.Router();
const { 
  getDashboardStats,
  getUserEngagement,
  getVideoPerformance,
  getInstitutePerformance,
  exportAnalyticsData
} = require('../controllers/analytics');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All analytics routes require authentication
router.use(authenticateToken);

// GET /api/analytics/dashboard-stats - Main dashboard statistics
router.get('/dashboard-stats', getDashboardStats);

// GET /api/analytics/user-engagement - User engagement metrics
router.get('/user-engagement', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getUserEngagement
);

// GET /api/analytics/video-performance - Video performance analytics
router.get('/video-performance', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getVideoPerformance
);

// GET /api/analytics/institute-performance - Institute performance metrics
router.get('/institute-performance', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getInstitutePerformance
);

// GET /api/analytics/export - Export analytics data
router.get('/export', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  exportAnalyticsData
);

module.exports = router;