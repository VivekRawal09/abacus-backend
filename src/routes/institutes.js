// =====================================================
// FIXED INSTITUTES ROUTES (routes/institutes.js)
// =====================================================
const express = require('express');
const router = express.Router();

const {
  getAllInstitutes,
  getInstituteById,
  getInstituteStats,
  createInstitute,
  updateInstitute,
  deleteInstitute,
  updateInstituteStatus,
  bulkUpdateInstituteStatus,
  bulkDeleteInstitutes
} = require('../controllers/institutes');

const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/institutes - Get all institutes with pagination and filters
router.get('/',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getAllInstitutes
);

// GET /api/institutes/stats - Get institute statistics
router.get('/stats',
  authorizeRoles('super_admin', 'zone_manager'),
  getInstituteStats
);

// BULK ROUTES - MUST come before /:id routes
router.put('/bulk-status',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  bulkUpdateInstituteStatus
);

router.delete('/bulk',
  authorizeRoles('super_admin', 'zone_manager'),
  bulkDeleteInstitutes
);

// GET /api/institutes/:id - Get single institute by ID
router.get('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getInstituteById
);

// POST /api/institutes - Create new institute
router.post('/',
  authorizeRoles('super_admin', 'zone_manager'),
  createInstitute
);

// PUT /api/institutes/:id - Update institute
router.put('/:id',
  authorizeRoles('super_admin', 'zone_manager'),
  updateInstitute
);

// PUT /api/institutes/:id/status - Toggle institute status
router.put('/:id/status',
  authorizeRoles('super_admin', 'zone_manager'),
  updateInstituteStatus
);

// DELETE /api/institutes/:id - Delete single institute
router.delete('/:id',
  authorizeRoles('super_admin', 'zone_manager'),
  deleteInstitute
);

module.exports = router;