const express = require('express');
const router = express.Router();
const { 
  getAllInstitutes, 
  getInstituteById, 
  getInstituteStats 
} = require('../controllers/institutes');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Institute management routes (admin only)
router.get('/', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getAllInstitutes
);

router.get('/stats', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager'),
  getInstituteStats
);

router.get('/:id', 
  authenticateToken, 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getInstituteById
);

module.exports = router;