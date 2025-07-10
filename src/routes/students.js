const express = require('express');
const router = express.Router();
const StudentsController = require('../controllers/students');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// 1. GET /api/students - List all students (admin only)
router.get('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  StudentsController.getAllStudents
);

// 2. GET /api/students/:id/progress - Student video progress summary
router.get('/:id/progress', 
  StudentsController.getStudentProgress
);

// 3. GET /api/students/:id/enrollments - Student course enrollments
router.get('/:id/enrollments', 
  StudentsController.getStudentEnrollments
);

// 4. GET /api/students/:id/points - Student points & rewards
router.get('/:id/points', 
  StudentsController.getStudentPoints
);

// 5. GET /api/students/:id/dashboard - Student dashboard data
router.get('/:id/dashboard', 
  StudentsController.getStudentDashboard
);

// 6. POST /api/students/:id/enroll - Enroll student in course
router.post('/:id/enroll', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  StudentsController.enrollStudent
);

// 7. PUT /api/students/:id/progress/:videoId - Update video progress
router.put('/:id/progress/:videoId', 
  StudentsController.updateVideoProgress
);

// 8. GET /api/students/:id/achievements - Student achievements
router.get('/:id/achievements', 
  StudentsController.getStudentAchievements
);

module.exports = router;