const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { importUsers } = require('../controllers/users');
const { 
  getAllUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  bulkDeleteUsers,
  exportUsers,
  validateUserCreation
} = require('../controllers/users');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/users - Get all users with pagination and filters
router.get('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'), 
  getAllUsers
);

// GET /api/users/stats - Get user statistics
router.get('/stats', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'), 
  getUserStats
);

// GET /api/users/export - Export users to CSV
router.get('/export', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'), 
  exportUsers
);

// GET /api/users/:id - Get single user by ID
router.get('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'), 
  getUserById
);

// POST /api/users - Create new user
router.post('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  validateUserCreation,
  createUser
);

// PUT /api/users/:id - Update user
router.put('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  updateUser
);

// PUT /api/users/:id/status - Toggle user status
router.put('/:id/status', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  updateUserStatus
);

// DELETE /api/users/:id - Delete single user (soft delete)
router.delete('/:id', 
  authorizeRoles('super_admin', 'zone_manager'),
  deleteUser
);

// DELETE /api/users/bulk - Bulk delete users
router.delete('/bulk', 
  authorizeRoles('super_admin', 'zone_manager'),
  bulkDeleteUsers
);

router.post(
  '/import',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'), // Only these roles can import
  upload.single('file'),
  importUsers
);

module.exports = router;