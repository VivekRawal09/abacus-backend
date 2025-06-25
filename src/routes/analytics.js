const express = require('express');
const router = express.Router();
const { 
  getDashboardStats,
  getUserEngagement,
  getVideoPerformance
} = require('../controllers/analytics');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Analytics routes (admin only)
router.get('/dashboard', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getDashboardStats
);

router.get('/user-engagement', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getUserEngagement
);

router.get('/video-performance', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getVideoPerformance
);

module.exports = router;