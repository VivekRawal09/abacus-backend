const express = require('express');
const router = express.Router();
const CoursesController = require('../controllers/courses');
const { 
  authenticateToken, 
  authorizeRoles, 
  validateDataScope 
} = require('../middleware/auth');

// ✅ UPDATED: Import new validation functions
const { 
  validateUUIDArray 
} = require('../utils/validationUtils');

// ✅ SECURITY: Apply authentication to all routes
router.use(authenticateToken);

// ✅ VALIDATION: Input validation middleware for course creation
const validateCourseCreation = (req, res, next) => {
  const { 
    name, 
    description, 
    level_number, 
    difficulty_level,
    target_age_min,
    target_age_max 
  } = req.body;
  
  // Required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Course name is required and must be a non-empty string'
    });
  }
  
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Course description is required and must be a non-empty string'
    });
  }
  
  if (!level_number || typeof level_number !== 'number' || level_number < 1 || level_number > 20) {
    return res.status(400).json({
      success: false,
      message: 'Level number is required and must be between 1 and 20'
    });
  }
  
  // Optional field validation
  if (difficulty_level && !['beginner', 'intermediate', 'advanced'].includes(difficulty_level)) {
    return res.status(400).json({
      success: false,
      message: 'Difficulty level must be one of: beginner, intermediate, advanced'
    });
  }
  
  if (target_age_min && (typeof target_age_min !== 'number' || target_age_min < 3 || target_age_min > 18)) {
    return res.status(400).json({
      success: false,
      message: 'Target minimum age must be between 3 and 18'
    });
  }
  
  if (target_age_max && (typeof target_age_max !== 'number' || target_age_max < 3 || target_age_max > 18)) {
    return res.status(400).json({
      success: false,
      message: 'Target maximum age must be between 3 and 18'
    });
  }
  
  if (target_age_min && target_age_max && target_age_min > target_age_max) {
    return res.status(400).json({
      success: false,
      message: 'Target minimum age cannot be greater than maximum age'
    });
  }
  
  next();
};

// ✅ VALIDATION: Input validation for course updates
const validateCourseUpdate = (req, res, next) => {
  const allowedFields = [
    'name', 'description', 'level_number', 'difficulty_level', 
    'target_age_min', 'target_age_max', 'estimated_duration_days',
    'learning_objectives', 'prerequisites', 'thumbnail_url', 'display_order'
  ];
  
  const updateFields = Object.keys(req.body);
  const validFields = updateFields.filter(field => allowedFields.includes(field));
  
  if (validFields.length === 0) {
    return res.status(400).json({
      success: false,
      message: `No valid fields provided. Allowed fields: ${allowedFields.join(', ')}`
    });
  }
  
  // Validate specific fields if provided
  if (req.body.level_number && (typeof req.body.level_number !== 'number' || req.body.level_number < 1 || req.body.level_number > 20)) {
    return res.status(400).json({
      success: false,
      message: 'Level number must be between 1 and 20'
    });
  }
  
  if (req.body.difficulty_level && !['beginner', 'intermediate', 'advanced'].includes(req.body.difficulty_level)) {
    return res.status(400).json({
      success: false,
      message: 'Difficulty level must be one of: beginner, intermediate, advanced'
    });
  }
  
  if (req.body.estimated_duration_days && (typeof req.body.estimated_duration_days !== 'number' || req.body.estimated_duration_days < 1)) {
    return res.status(400).json({
      success: false,
      message: 'Estimated duration must be a positive number'
    });
  }
  
  next();
};

// ✅ VALIDATION: Lesson creation validation
const validateLessonCreation = (req, res, next) => {
  const { title, description, lesson_type, lesson_number } = req.body;
  
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Lesson title is required and must be a non-empty string'
    });
  }
  
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Lesson description is required and must be a non-empty string'
    });
  }
  
  if (lesson_type && !['video', 'exercise', 'assessment', 'reading'].includes(lesson_type)) {
    return res.status(400).json({
      success: false,
      message: 'Lesson type must be one of: video, exercise, assessment, reading'
    });
  }
  
  if (lesson_number && (typeof lesson_number !== 'number' || lesson_number < 1)) {
    return res.status(400).json({
      success: false,
      message: 'Lesson number must be a positive number'
    });
  }
  
  next();
};

// ✅ VALIDATION: Reorder lessons validation
const validateReorderLessons = (req, res, next) => {
  const { lesson_orders } = req.body;
  
  if (!Array.isArray(lesson_orders) || lesson_orders.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'lesson_orders must be a non-empty array'
    });
  }
  
  // Validate each item in the array
  for (const item of lesson_orders) {
    if (!item.lesson_id || !item.lesson_number || 
        typeof item.lesson_number !== 'number' || 
        item.lesson_number < 1) {
      return res.status(400).json({
        success: false,
        message: 'Each item must have lesson_id and lesson_number (positive number)'
      });
    }
    
    // Validate UUID format for lesson_id
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(item.lesson_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson ID format'
      });
    }
  }
  
  next();
};

// ✅ FIXED: Bulk enrollment validation using new standardized validation
const validateBulkEnrollment = (req, res, next) => {
  const { student_ids } = req.body;
  
  const idsValidation = validateUUIDArray(student_ids, 'Student IDs', 100);
  if (!idsValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: idsValidation.error
    });
  }
  
  console.log('👥 Student enrollment attempt:', {
    userId: req.user.id,
    courseId: req.params.id,
    studentCount: idsValidation.count,
    timestamp: new Date().toISOString()
  });
  
  // ✅ FIXED: Attach validated data to request
  req.validatedBulk = {
    ids: idsValidation.validIds,
    count: idsValidation.count
  };
  
  next();
};

// ✅ VALIDATION: Bulk create validation
const validateBulkCreate = (req, res, next) => {
  const { course_data, template_course_id } = req.body;
  
  if (!Array.isArray(course_data) || course_data.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'course_data must be a non-empty array'
    });
  }
  
  if (course_data.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Bulk create limited to 50 courses at a time'
    });
  }
  
  // Validate template course ID if provided
  if (template_course_id) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(template_course_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template course ID format'
      });
    }
  }
  
  // Basic validation for each course in the array
  for (const courseInfo of course_data) {
    if (courseInfo.level_number && (typeof courseInfo.level_number !== 'number' || courseInfo.level_number < 1 || courseInfo.level_number > 20)) {
      return res.status(400).json({
        success: false,
        message: 'Level number must be between 1 and 20 for all courses'
      });
    }
    
    if (courseInfo.difficulty_level && !['beginner', 'intermediate', 'advanced'].includes(courseInfo.difficulty_level)) {
      return res.status(400).json({
        success: false,
        message: 'Difficulty level must be one of: beginner, intermediate, advanced'
      });
    }
  }
  
  next();
};

// ✅ VALIDATION: UUID parameter validation
const validateCourseId = (req, res, next) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!uuidRegex.test(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid course ID format'
    });
  }
  
  next();
};

// ✅ SECURITY: Role-based permissions
const requireAdmin = (req, res, next) => {
  if (req.user && (req.user.permissions.isSuperAdmin || req.user.permissions.isInstituteAdmin)) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Admin access required for this operation'
    });
  }
};

const requireCreatePermission = (req, res, next) => {
  if (req.user && (req.user.permissions.isSuperAdmin || req.user.permissions.isZoneManager || req.user.permissions.isInstituteAdmin)) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Insufficient permissions to create courses'
    });
  }
};

const requireViewPermission = (req, res, next) => {
  // All authenticated users can view courses
  next();
};

// ========================
// COURSE ROUTES
// ========================

// Public routes (require basic authentication only)

// 1. GET /api/courses - List all courses with pagination and filters
router.get('/', 
  requireViewPermission,
  CoursesController.getAllCourses
);

// 2. GET /api/courses/levels - Get available course levels (before :id routes)
router.get('/levels', 
  requireViewPermission,
  CoursesController.getCourseLevels
);

// 3. GET /api/courses/export - Export course data
router.get('/export', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  CoursesController.exportCourses
);

// Admin-only routes

// 4. POST /api/courses - Create new course
router.post('/', 
  requireCreatePermission,
  validateCourseCreation,
  (req, res, next) => {
    // ✅ SECURITY: Log course creation attempt
    console.log('📚 Course creation request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseName: req.body.name,
      level: req.body.level_number,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.createCourse
);

// 5. POST /api/courses/bulk-create - Create multiple courses
router.post('/bulk-create', 
  authorizeRoles('super_admin', 'zone_manager'),
  validateBulkCreate,
  (req, res, next) => {
    // ✅ SECURITY: Log bulk creation attempt
    console.log('📚 Bulk course creation request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseCount: req.body.course_data?.length || 0,
      templateId: req.body.template_course_id,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.bulkCreateCourses
);

// Individual course routes (with ID validation)

// 6. GET /api/courses/:id - Get course details
router.get('/:id', 
  validateCourseId,
  requireViewPermission,
  CoursesController.getCourseById
);

// 7. PUT /api/courses/:id - Update course
router.put('/:id', 
  validateCourseId,
  requireAdmin,
  validateCourseUpdate,
  (req, res, next) => {
    // ✅ SECURITY: Log course update attempt
    console.log('✏️ Course update request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseId: req.params.id,
      updateFields: Object.keys(req.body),
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.updateCourse
);

// 8. DELETE /api/courses/:id - Soft delete course
router.delete('/:id', 
  validateCourseId,
  authorizeRoles('super_admin', 'zone_manager'),
  (req, res, next) => {
    // ✅ SECURITY: Log course deletion attempt
    console.log('🗑️ Course deletion request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseId: req.params.id,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.deleteCourse
);

// Lesson management routes

// 9. GET /api/courses/:id/lessons - Get course lessons
router.get('/:id/lessons', 
  validateCourseId,
  requireViewPermission,
  CoursesController.getCourseLessons
);

// 10. POST /api/courses/:id/lessons - Add lesson to course
router.post('/:id/lessons', 
  validateCourseId,
  requireAdmin,
  validateLessonCreation,
  (req, res, next) => {
    // ✅ SECURITY: Log lesson creation attempt
    console.log('📖 Lesson creation request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseId: req.params.id,
      lessonTitle: req.body.title,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.addLessonToCourse
);

// 11. PUT /api/courses/:id/reorder-lessons - Reorder lessons
router.put('/:id/reorder-lessons', 
  validateCourseId,
  requireAdmin,
  validateReorderLessons,
  (req, res, next) => {
    // ✅ SECURITY: Log lesson reordering attempt
    console.log('🔄 Lesson reordering request:', {
      userId: req.user.id,
      userRole: req.user.role,
      courseId: req.params.id,
      lessonCount: req.body.lesson_orders?.length || 0,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.reorderLessons
);

// Student management routes

// 12. GET /api/courses/:id/students - Get enrolled students
router.get('/:id/students', 
  validateCourseId,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  CoursesController.getCourseStudents
);

// ✅ FIXED: Student enrollment with standardized validation
// 13. POST /api/courses/:id/enroll-students - Bulk enroll students
router.post('/:id/enroll-students', 
  validateCourseId,
  requireAdmin,
  validateBulkEnrollment,  // ✅ This now uses the standardized validation and sets req.validatedBulk
  CoursesController.enrollStudents
);

// Analytics and reporting routes

// 14. GET /api/courses/:id/analytics - Course analytics
router.get('/:id/analytics', 
  validateCourseId,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  CoursesController.getCourseAnalytics
);

// Advanced operations

// 15. POST /api/courses/:id/duplicate - Duplicate course
router.post('/:id/duplicate', 
  validateCourseId,
  authorizeRoles('super_admin', 'zone_manager'),
  (req, res, next) => {
    // ✅ SECURITY: Log course duplication attempt
    console.log('📋 Course duplication request:', {
      userId: req.user.id,
      userRole: req.user.role,
      originalCourseId: req.params.id,
      newName: req.body.new_name,
      timestamp: new Date().toISOString()
    });
    next();
  },
  CoursesController.duplicateCourse
);

// ✅ ENHANCED: Error handling middleware
router.use((error, req, res, next) => {
  // Log all errors for security monitoring
  console.error('🚨 Course route error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    userRole: req.user?.role,
    path: req.path,
    method: req.method,
    body: req.method !== 'GET' ? req.body : undefined,
    timestamp: new Date().toISOString()
  });

  // Handle specific error types
  if (error.message.includes('UUID') || error.message.includes('Invalid course ID')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid course ID format',
      errorCode: 'INVALID_ID'
    });
  }

  if (error.message.includes('Authentication required') || error.message.includes('Insufficient permissions')) {
    return res.status(403).json({
      success: false,
      message: error.message,
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

  // Generic error handling
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});

// ✅ CATCH-ALL: Handle undefined course routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Course route not found',
    available_endpoints: [
      'GET /api/courses',
      'POST /api/courses', 
      'GET /api/courses/:id',
      'PUT /api/courses/:id',
      'DELETE /api/courses/:id',
      'GET /api/courses/:id/lessons',
      'POST /api/courses/:id/lessons',
      'PUT /api/courses/:id/reorder-lessons',
      'GET /api/courses/:id/students',
      'POST /api/courses/:id/enroll-students',
      'GET /api/courses/:id/analytics',
      'POST /api/courses/:id/duplicate',
      'GET /api/courses/levels',
      'POST /api/courses/bulk-create',
      'GET /api/courses/export'
    ],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;