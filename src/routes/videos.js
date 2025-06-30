const express = require('express');
const router = express.Router();
const { 
  getAllVideos,
  getVideoById,
  addVideoFromYouTube,
  searchYouTubeVideos,
  getVideoCategories,
  updateVideo,
  deleteVideo,
  updateVideoStatus,
  bulkUpdateUsers,
  bulkDeleteVideos,
  getVideoStats
} = require('../controllers/videos');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/videos - Get all videos with pagination and filters
router.get('/', getAllVideos);

// GET /api/videos/search-youtube - Search YouTube videos
router.get('/search-youtube', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  searchYouTubeVideos
);

// GET /api/videos/categories - Get video categories
router.get('/categories', getVideoCategories);

// GET /api/videos/stats - Get video statistics
router.get('/stats', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getVideoStats
);

// GET /api/videos/:id - Get single video by ID
router.get('/:id', getVideoById);

// POST /api/videos - Add video from YouTube
router.post('/', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  addVideoFromYouTube
);

// PUT /api/videos/:id - Update video
router.put('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  updateVideo
);

// ADD this route BEFORE the /:id routes:
router.put('/bulk-status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkUpdateVideoStatus
);

// PUT /api/videos/:id/status - Toggle video status
router.put('/:id/status', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  updateVideoStatus
);

// DELETE /api/videos/:id - Delete single video (soft delete)
router.delete('/:id', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  deleteVideo
);

// DELETE /api/videos/bulk - Bulk delete videos
router.delete('/bulk', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkDeleteVideos
);
// Add this route BEFORE the /:id routes
router.put('/bulk-update',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkUpdateUsers
);

module.exports = router;