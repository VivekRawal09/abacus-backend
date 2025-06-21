const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const {
  getAllVideos,
  getVideoById,
  addVideoFromYouTube,
  searchYouTubeVideos,
  getVideoCategories
} = require('../controllers/videos');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Public/Student routes
router.get('/', authenticateToken, getAllVideos);
router.get('/categories', authenticateToken, getVideoCategories);
router.get('/search-youtube', 
  authenticateToken, 
  authorizeRoles('super_admin', 'institute_admin'),
  [query('query').notEmpty().withMessage('Search query is required')],
  searchYouTubeVideos
);
router.get('/:id', authenticateToken, getVideoById);

// Admin routes
router.post('/', 
  authenticateToken,
  authorizeRoles('super_admin', 'institute_admin'),
  [
    body('youtubeVideoId').notEmpty().withMessage('YouTube video ID is required'),
    body('category').optional().trim(),
    body('difficulty').optional().isIn(['beginner', 'intermediate', 'advanced']),
    body('courseOrder').optional().isInt({ min: 1 }),
    body('tags').optional().isArray()
  ],
  addVideoFromYouTube
);

module.exports = router;