const express = require('express');
const router = express.Router();
const LessonsController = require('../controllers/lessons');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// 1. GET /api/lessons - List all lessons
router.get('/', 
  LessonsController.getAllLessons
);

// 2. POST /api/lessons - Create lesson (admin only)
router.post('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  LessonsController.createLesson
);

// 3. GET /api/lessons/:id - Get lesson details
router.get('/:id', 
  LessonsController.getLessonById
);

// 4. PUT /api/lessons/:id - Update lesson (admin only)
router.put('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  LessonsController.updateLesson
);

// 5. DELETE /api/lessons/:id - Delete lesson (admin only)
router.delete('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  LessonsController.deleteLesson
);

// 6. GET /api/lessons/:id/content - Get lesson content
router.get('/:id/content', 
  LessonsController.getLessonContent
);

// 7. POST /api/lessons/:id/content - Add lesson content (admin only)
router.post('/:id/content', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  LessonsController.addLessonContent
);

// 8. PUT /api/lessons/:id/content/:contentId - Update lesson content (admin only)
router.put('/:id/content/:contentId', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  LessonsController.updateLessonContent
);

module.exports = router;