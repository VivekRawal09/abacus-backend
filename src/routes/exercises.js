const express = require('express');
const router = express.Router();
const ExerciseController = require('../controllers/exercises');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ 1. GET /api/exercises/categories - Get exercise categories
router.get('/categories',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  ExerciseController.getExerciseCategories
);

// ✅ 2. GET /api/exercises - Get all exercises with filtering
router.get('/',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // Basic validation middleware
  (req, res, next) => {
    const { page, limit, category_id, difficulty_level } = req.query;
    
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
    
    if (category_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }
    
    const validDifficulties = ['beginner', 'intermediate', 'advanced'];
    if (difficulty_level && !validDifficulties.includes(difficulty_level)) {
      return res.status(400).json({
        success: false,
        message: 'Difficulty level must be: beginner, intermediate, or advanced'
      });
    }
    
    next();
  },
  ExerciseController.getAllExercises
);

// ✅ 3. POST /api/exercises - Create exercise (admin only)
router.post('/',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { category_id, problem_text, problem_type, operand1, operator, correct_answer } = req.body;
    
    if (!category_id || !problem_text || !problem_type || operand1 === undefined || !operator || correct_answer === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: category_id, problem_text, problem_type, operand1, operator, correct_answer'
      });
    }
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }
    
    const validTypes = ['addition', 'subtraction', 'multiplication', 'division', 'mixed'];
    if (!validTypes.includes(problem_type)) {
      return res.status(400).json({
        success: false,
        message: 'Problem type must be: addition, subtraction, multiplication, division, or mixed'
      });
    }
    
    next();
  },
  ExerciseController.createExercise
);

// ✅ 4. GET /api/exercises/:id - Get exercise details
router.get('/:id',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
    }
    next();
  },
  ExerciseController.getExerciseById
);

// ✅ 5. PUT /api/exercises/:id - Update exercise (admin only)
router.put('/:id',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
    }
    next();
  },
  ExerciseController.updateExercise
);

// ✅ 6. DELETE /api/exercises/:id - Delete exercise (admin only)
router.delete('/:id',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
    }
    next();
  },
  ExerciseController.deleteExercise
);

// ✅ 7. POST /api/exercises/:id/attempt - Submit exercise attempt (students)
router.post('/:id/attempt',
  authenticateToken,
  authorizeRoles('student'),
  // Validation middleware
  (req, res, next) => {
    const { id } = req.params;
    const { student_answer, session_id } = req.body;
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
    }
    
    if (student_answer === undefined || student_answer === null) {
      return res.status(400).json({
        success: false,
        message: 'Student answer is required'
      });
    }
    
    if (session_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid session ID format'
      });
    }
    
    next();
  },
  ExerciseController.submitAttempt
);

// ✅ 8. GET /api/exercises/:id/attempts - Get exercise attempts
router.get('/:id/attempts',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID format'
      });
    }
    next();
  },
  ExerciseController.getExerciseAttempts
);

// ✅ 9. GET /api/exercises/sessions/:studentId - Get exercise sessions
router.get('/sessions/:studentId',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { studentId } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID format'
      });
    }
    next();
  },
  ExerciseController.getExerciseSessions
);

module.exports = router;