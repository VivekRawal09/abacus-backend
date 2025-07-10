const express = require('express');
const router = express.Router();
const AssessmentsController = require('../controllers/assessments');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// 1. GET /api/assessments - Get all assessments
router.get('/', 
  AssessmentsController.getAllAssessments
);

// 2. POST /api/assessments - Create assessment (admin only)
router.post('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AssessmentsController.createAssessment
);

// 3. GET /api/assessments/:id - Get assessment details
router.get('/:id', 
  AssessmentsController.getAssessmentById
);

// 4. PUT /api/assessments/:id - Update assessment (admin only)
router.put('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AssessmentsController.updateAssessment
);

// 5. DELETE /api/assessments/:id - Delete assessment (admin only)
router.delete('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AssessmentsController.deleteAssessment
);

// 6. POST /api/assessments/:id/submit - Submit assessment (students)
router.post('/:id/submit', 
  AssessmentsController.submitAssessment
);

// 7. GET /api/assessments/:id/results - Get assessment results
router.get('/:id/results', 
  AssessmentsController.getAssessmentResults
);

// 8. GET /api/assessments/:id/analytics - Assessment analytics (admin)
router.get('/:id/analytics', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AssessmentsController.getAssessmentAnalytics
);

module.exports = router;