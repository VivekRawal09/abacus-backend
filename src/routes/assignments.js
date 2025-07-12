const express = require('express');
const router = express.Router();
const AssignmentController = require('../controllers/assignments');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// ✅ CRITICAL FIX: Static routes MUST come BEFORE parameterized routes
// This fixes the "Invalid assignment ID format" error for /templates

// 1. GET /api/assignments/templates - Get assignment templates (MUST BE FIRST!)
router.get('/templates',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { template_type, difficulty_level, is_active } = req.query;
    
    const validTemplateTypes = ['video_sequence', 'lesson_series', 'practice_set', 'assessment'];
    if (template_type && !validTemplateTypes.includes(template_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template type. Valid options: video_sequence, lesson_series, practice_set, assessment'
      });
    }
    
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty_level && !validDifficulties.includes(difficulty_level)) {
      return res.status(400).json({
        success: false,
        message: 'Difficulty level must be: beginner, intermediate, or advanced'
      });
    }
    
    if (is_active && !['true', 'false'].includes(is_active)) {
      return res.status(400).json({
        success: false,
        message: 'is_active must be true or false'
      });
    }
    
    console.log('📋 Assignment templates request:', {
      userId: req.user.id,
      userRole: req.user.role,
      filters: { template_type, difficulty_level, is_active },
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  AssignmentController.getAssignmentTemplates
);

// 2. POST /api/assignments/video-based - Create video-based assignment (MUST BE BEFORE /:id)
router.post('/video-based',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { student_ids, video_ids, due_date } = req.body;
    
    if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'student_ids array is required and cannot be empty'
      });
    }
    
    if (!video_ids || !Array.isArray(video_ids) || video_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'video_ids array is required and cannot be empty'
      });
    }
    
    if (student_ids.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign to more than 100 students at once'
      });
    }
    
    if (video_ids.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign more than 50 videos at once'
      });
    }
    
    // Validate UUID format for student_ids
    const invalidStudentIds = student_ids.filter(id => 
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    );
    
    if (invalidStudentIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format in array'
      });
    }
    
    // Validate UUID format for video_ids
    const invalidVideoIds = video_ids.filter(id => 
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    );
    
    if (invalidVideoIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format in array'
      });
    }
    
    if (due_date && isNaN(Date.parse(due_date))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid due_date format. Use YYYY-MM-DD'
      });
    }
    
    console.log('🎬 Video-based assignment creation:', {
      userId: req.user.id,
      userRole: req.user.role,
      studentCount: student_ids.length,
      videoCount: video_ids.length,
      dueDate: due_date,
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  AssignmentController.createVideoBasedAssignment
);

// 3. GET /api/assignments - Get assignments (list)
router.get('/',
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { page, limit, student_id, completed, priority, due_date } = req.query;
    
    if (page && (isNaN(page) || parseInt(page) < 1)) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive number'
      });
    }
    
    if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100'
      });
    }
    
    if (student_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(student_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }
    
    if (completed && !['true', 'false'].includes(completed)) {
      return res.status(400).json({
        success: false,
        message: 'completed must be true or false'
      });
    }
    
    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be: low, medium, or high'
      });
    }
    
    if (due_date && isNaN(Date.parse(due_date))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid due_date format. Use YYYY-MM-DD'
      });
    }
    
    next();
  },
  AssignmentController.getAssignments
);

// 4. POST /api/assignments - Create assignment (admin only)
router.post('/',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { student_id, video_id, lesson_id, due_date, is_mandatory = true } = req.body;
    
    if (!student_id) {
      return res.status(400).json({
        success: false,
        message: 'student_id is required'
      });
    }
    
    if (!video_id && !lesson_id) {
      return res.status(400).json({
        success: false,
        message: 'Either video_id or lesson_id is required'
      });
    }
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(student_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }
    
    if (video_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(video_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID format'
      });
    }
    
    if (lesson_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lesson_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson ID format'
      });
    }
    
    if (due_date && isNaN(Date.parse(due_date))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid due_date format. Use YYYY-MM-DD'
      });
    }
    
    const validPriorities = ['low', 'medium', 'high'];
    if (req.body.priority && !validPriorities.includes(req.body.priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be: low, medium, or high'
      });
    }
    
    console.log('📝 Assignment creation:', {
      userId: req.user.id,
      userRole: req.user.role,
      studentId: student_id,
      videoId: video_id,
      lessonId: lesson_id,
      dueDate: due_date,
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  AssignmentController.createAssignment
);

// 5. GET /api/assignments/:id - Get assignment details (MUST COME AFTER static routes)
router.get('/:id',
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID format'
      });
    }
    next();
  },
  AssignmentController.getAssignmentById
);

// 6. PUT /api/assignments/:id - Update assignment (admin only)
router.put('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID format'
      });
    }
    
    const { due_date, priority } = req.body;
    
    if (due_date && isNaN(Date.parse(due_date))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid due_date format. Use YYYY-MM-DD'
      });
    }
    
    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be: low, medium, or high'
      });
    }
    
    console.log('✏️ Assignment update:', {
      userId: req.user.id,
      userRole: req.user.role,
      assignmentId: id,
      updateFields: Object.keys(req.body),
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  AssignmentController.updateAssignment
);

// 7. POST /api/assignments/:id/submit - Submit assignment (students)
router.post('/:id/submit',
  authorizeRoles('student'),
  // Validation middleware
  (req, res, next) => {
    const { id } = req.params;
    const { notes } = req.body;
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID format'
      });
    }
    
    if (notes && typeof notes !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Notes must be a string'
      });
    }
    
    if (notes && notes.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Notes must be 1000 characters or less'
      });
    }
    
    console.log('✅ Assignment submission:', {
      userId: req.user.id,
      userRole: req.user.role,
      assignmentId: id,
      hasNotes: !!notes,
      timestamp: new Date().toISOString()
    });
    
    next();
  },
  AssignmentController.submitAssignment
);

module.exports = router;