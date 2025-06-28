const express = require('express');
const router = express.Router();
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Allow Excel files
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream' // sometimes Excel files come as this
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload an Excel file (.xlsx or .xls)'));
    }
  }
});

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
  validateUserCreation,
  importUsers
} = require('../controllers/users');

const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Apply authentication to all routes
router.use(authenticateToken);

// Import route - MUST come before the /:id route to avoid conflicts
router.post('/import',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  upload.single('file'),
  importUsers
);

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

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Please upload only one file.'
      });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next(error);
});

module.exports = router;