const express = require('express');
const router = express.Router();
const { getAllUsers, getUserStats } = require('../controllers/users');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// User management routes (admin only)
router.get('/', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getAllUsers
);

router.get('/stats', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getUserStats
);

module.exports = router;