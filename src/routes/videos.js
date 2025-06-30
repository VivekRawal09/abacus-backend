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
  bulkDeleteVideos,
  bulkUpdateVideoStatus, // ✅ CORRECT: Video status function (not user function)
  getVideoStats
  // ❌ REMOVED: bulkUpdateUsers (was wrong import)
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

// BULK ROUTES - MUST come before /:id routes
router.put('/bulk-status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkUpdateVideoStatus  // ✅ CORRECT: Video status function
);

router.delete('/bulk',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkDeleteVideos
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

// PUT /api/videos/:id/status - Toggle video status
router.put('/:id/status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  updateVideoStatus
);

// DELETE /api/videos/:id - Delete single video
router.delete('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  deleteVideo
);

module.exports = router;