const express = require('express');
const router = express.Router();
const multer = require('multer');

// ✅ SECURITY FIX: Enhanced multer configuration with strict validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
    fields: 10, // Limit form fields
    fieldSize: 1024 * 1024, // 1MB per field
    headerPairs: 20 // Limit header pairs
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 File upload attempt:', {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      userId: req.user?.id,
      userRole: req.user?.role
    });

    // ✅ SECURITY FIX: Strict MIME type validation (removed permissive types)
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel' // .xls
      // ✅ REMOVED: 'application/octet-stream' - too permissive and dangerous
    ];

    if (allowedMimes.includes(file.mimetype)) {
      // ✅ SECURITY FIX: Additional file extension validation
      const allowedExtensions = ['.xlsx', '.xls'];
      const fileExtension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      
      if (allowedExtensions.includes(fileExtension)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file extension. Only ${allowedExtensions.join(', ')} files are allowed.`));
      }
    } else {
      cb(new Error('Invalid file type. Please upload an Excel file (.xlsx or .xls)'));
    }
  }
});

// ✅ SECURITY FIX: Import controllers and enhanced middleware
const {
  getAllUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  bulkDeleteUsers,
  bulkUpdateUsers,
  bulkUpdateUserStatus,
  exportUsers,
  validateUserCreation,
  importUsers
} = require('../controllers/users');

const { 
  authenticateToken, 
  authorizeRoles, 
  validateDataScope 
} = require('../middleware/auth');

// ✅ UPDATED: Import new validation functions
const { 
  validateUUIDArray,  // ← CHANGED: Use UUID validation for users
  validateBoolean, 
  validateConfirmation 
} = require('../utils/validationUtils');

// ✅ SECURITY FIX: Apply authentication to all routes
router.use(authenticateToken);

// ✅ SECURITY FIX: Enhanced import route with comprehensive security
router.post('/import',
  // Step 1: Role-based authorization
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  
  // Step 2: File upload with enhanced validation
  (req, res, next) => {
    // ✅ SECURITY FIX: Pre-upload validation
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for file upload'
      });
    }

    // ✅ SECURITY FIX: Rate limiting for file uploads (simple implementation)
    const now = Date.now();
    const uploadKey = `upload_${req.user.id}`;
    
    if (!req.app.locals.uploadAttempts) {
      req.app.locals.uploadAttempts = new Map();
    }
    
    const lastUpload = req.app.locals.uploadAttempts.get(uploadKey);
    if (lastUpload && (now - lastUpload) < 60000) { // 1 minute cooldown
      return res.status(429).json({
        success: false,
        message: 'Please wait before uploading another file'
      });
    }
    
    req.app.locals.uploadAttempts.set(uploadKey, now);
    next();
  },
  
  // Step 3: File upload processing
  upload.single('file'),
  
  // Step 4: Import processing
  importUsers
);

// ✅ SECURITY FIX: Enhanced user listing with data scope validation
router.get('/',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Note: Data scoping is handled within getAllUsers controller
  getAllUsers
);

// ✅ SECURITY FIX: User statistics with role-based access
router.get('/stats',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getUserStats
);

// ✅ SECURITY FIX: User export with data scoping
router.get('/export',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Note: Export scoping is handled within exportUsers controller
  exportUsers
);

// ✅ FIXED: Bulk operations with standardized validation
// IMPORTANT: Bulk routes MUST come before /:id routes to avoid conflicts

router.put('/bulk-status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  (req, res, next) => {
    const { userIds, is_active } = req.body;
    
    // ✅ FIXED: Use UUID validation instead of integer
    const idsValidation = validateUUIDArray(userIds, 'User IDs', 100);
    if (!idsValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: idsValidation.error
      });
    }
    
    // ✅ FIXED: Validate status
    const statusValidation = validateBoolean(is_active, 'is_active');
    if (!statusValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: statusValidation.error
      });
    }
    
    // Log bulk operation for audit trail
    console.log('🔄 Bulk status update attempt:', {
      userId: req.user.id,
      userRole: req.user.role,
      targetCount: idsValidation.count,
      newStatus: is_active,
      timestamp: new Date().toISOString()
    });
    
    // ✅ FIXED: Attach validated data to request
    req.validatedBulk = {
      ids: idsValidation.validIds,
      count: idsValidation.count
    };
    
    next();
  },
  bulkUpdateUserStatus
);

router.put('/bulk-update',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  (req, res, next) => {
    const { userIds, updateData } = req.body;
    
    // ✅ FIXED: Use UUID validation instead of integer
    const idsValidation = validateUUIDArray(userIds, 'User IDs', 100);
    if (!idsValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: idsValidation.error
      });
    }
    
    // ✅ FIXED: Validate update data
    if (!updateData || typeof updateData !== 'object' || Array.isArray(updateData)) {
      return res.status(400).json({
        success: false,
        message: 'updateData must be a valid object'
      });
    }
    
    // ✅ SECURITY FIX: Prevent sensitive field updates in bulk
    const forbiddenFields = ['password_hash', 'id', 'created_at', 'email'];
    const attemptedForbiddenFields = forbiddenFields.filter(field => 
      updateData && updateData.hasOwnProperty(field)
    );
    
    if (attemptedForbiddenFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot update protected fields: ${attemptedForbiddenFields.join(', ')}`
      });
    }
    
    // Log bulk operation for audit trail
    console.log('🔄 Bulk update attempt:', {
      userId: req.user.id,
      userRole: req.user.role,
      targetCount: idsValidation.count,
      updateFields: updateData ? Object.keys(updateData) : [],
      timestamp: new Date().toISOString()
    });
    
    // ✅ FIXED: Attach validated data to request
    req.validatedBulk = {
      ids: idsValidation.validIds,
      count: idsValidation.count
    };
    
    next();
  },
  bulkUpdateUsers
);

router.delete('/bulk',
  // ✅ SECURITY FIX: Only super_admin and zone_manager can bulk delete
  authorizeRoles('super_admin', 'zone_manager'),
  (req, res, next) => {
    const { userIds, confirmDelete } = req.body;
    
    // ✅ FIXED: Use UUID validation instead of integer (smaller limit for safety)
    const idsValidation = validateUUIDArray(userIds, 'User IDs', 50);
    if (!idsValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: idsValidation.error
      });
    }
    
    // ✅ FIXED: Require explicit confirmation
    const confirmValidation = validateConfirmation(confirmDelete, 'Bulk delete');
    if (!confirmValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: confirmValidation.error
      });
    }
    
    // Log critical operation for audit trail
    console.log('🚨 BULK DELETE attempt:', {
      userId: req.user.id,
      userRole: req.user.role,
      targetCount: idsValidation.count,
      targetIds: idsValidation.validIds,
      timestamp: new Date().toISOString(),
      confirmed: confirmDelete
    });
    
    // ✅ FIXED: Attach validated data to request
    req.validatedBulk = {
      ids: idsValidation.validIds,
      count: idsValidation.count
    };
    
    next();
  },
  bulkDeleteUsers
);

// ✅ SECURITY FIX: Individual user operations with data scope validation

router.get('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  validateDataScope('user'), // ✅ NEW: Validates user can access this specific user
  getUserById
);

router.post('/',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // ✅ SECURITY FIX: Enhanced input validation
  validateUserCreation,
  // ✅ SECURITY FIX: Additional security checks
  (req, res, next) => {
    const { role, institute_id, zone_id } = req.body;
    
    // ✅ SECURITY FIX: Prevent privilege escalation
    if (role === 'super_admin' && !req.user.permissions.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Cannot create super admin users'
      });
    }
    
    // ✅ SECURITY FIX: Log user creation attempts
    console.log('👤 User creation attempt:', {
      creatorId: req.user.id,
      creatorRole: req.user.role,
      targetRole: role,
      targetInstitute: institute_id,
      targetZone: zone_id,
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  createUser
);

router.put('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  validateDataScope('user'), // ✅ NEW: Validates user can modify this specific user
  // ✅ SECURITY FIX: Prevent sensitive field updates
  (req, res, next) => {
    const forbiddenFields = ['password_hash', 'id', 'created_at'];
    const attemptedForbiddenFields = forbiddenFields.filter(field => 
      req.body.hasOwnProperty(field)
    );
    
    if (attemptedForbiddenFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot update protected fields: ${attemptedForbiddenFields.join(', ')}`
      });
    }
    
    // ✅ SECURITY FIX: Prevent privilege escalation
    if (req.body.role === 'super_admin' && !req.user.permissions.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Cannot assign super admin role'
      });
    }
    
    // Log user modification attempts
    console.log('✏️ User update attempt:', {
      editorId: req.user.id,
      editorRole: req.user.role,
      targetId: req.params.id,
      updateFields: Object.keys(req.body),
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  updateUser
);

router.put('/:id/status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  validateDataScope('user'), // ✅ NEW: Validates user can modify this specific user
  // ✅ SECURITY FIX: Additional status update validation
  (req, res, next) => {
    const { is_active } = req.body;
    
    // Log status change attempts
    console.log('🔄 User status change attempt:', {
      editorId: req.user.id,
      editorRole: req.user.role,
      targetId: req.params.id,
      newStatus: is_active ? 'active' : 'inactive',
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  updateUserStatus
);

router.delete('/:id',
  // ✅ SECURITY FIX: Only super_admin and zone_manager can delete individual users
  authorizeRoles('super_admin', 'zone_manager'),
  validateDataScope('user'), // ✅ NEW: Validates user can delete this specific user
  // ✅ SECURITY FIX: Additional delete validation
  (req, res, next) => {
    const { id } = req.params;
    
    // ✅ SECURITY FIX: Prevent self-deletion
    if (id === req.user.id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    // Log critical operation for audit trail
    console.log('🚨 USER DELETE attempt:', {
      deleterId: req.user.id,
      deleterRole: req.user.role,
      targetId: id,
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  deleteUser
);

// ✅ SECURITY FIX: Enhanced error handling middleware for multer and general errors
router.use((error, req, res, next) => {
  // Log all errors for security monitoring
  console.error('🚨 Route error occurred:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    userRole: req.user?.role,
    path: req.path,
    method: req.method,
    body: req.method !== 'GET' ? req.body : undefined,
    timestamp: new Date().toISOString()
  });

  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 10MB.',
          errorCode: 'FILE_TOO_LARGE'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files. Please upload only one file.',
          errorCode: 'TOO_MANY_FILES'
        });
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many form fields.',
          errorCode: 'TOO_MANY_FIELDS'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Unexpected file field.',
          errorCode: 'UNEXPECTED_FILE'
        });
      default:
        return res.status(400).json({
          success: false,
          message: 'File upload error.',
          errorCode: 'UPLOAD_ERROR'
        });
    }
  }

  // ✅ SECURITY FIX: Handle file type validation errors
  if (error.message.includes('Invalid file type') || error.message.includes('Invalid file extension')) {
    return res.status(400).json({
      success: false,
      message: error.message,
      errorCode: 'INVALID_FILE_TYPE'
    });
  }

  // ✅ SECURITY FIX: Handle authentication/authorization errors
  if (error.message.includes('Authentication required') || error.message.includes('Insufficient permissions')) {
    return res.status(403).json({
      success: false,
      message: error.message,
      errorCode: 'ACCESS_DENIED'
    });
  }

  // Generic error handling
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});

// ✅ SECURITY FIX: Clean up rate limiting data periodically
setInterval(() => {
  if (router.app && router.app.locals.uploadAttempts) {
    const now = Date.now();
    const cutoff = 5 * 60 * 1000; // 5 minutes
    
    for (const [key, timestamp] of router.app.locals.uploadAttempts.entries()) {
      if (now - timestamp > cutoff) {
        router.app.locals.uploadAttempts.delete(key);
      }
    }
  }
}, 60000); // Clean up every minute

module.exports = router;