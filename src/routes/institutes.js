const express = require('express');
const router = express.Router();
const {
  getAllInstitutes,
  getInstituteById,
  getInstituteStats,
  createInstitute,        // NEW - FIX FOR 404 ERROR
  updateInstitute,        // NEW
  deleteInstitute,        // NEW
  updateInstituteStatus,  // NEW
  bulkDeleteInstitutes    // NEW
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

// GET /api/institutes/:id - Get single institute by ID
router.get('/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  getInstituteById
);

// POST /api/institutes - Create new institute (FIX: THIS WAS MISSING - CAUSING 404)
router.post('/',
  authorizeRoles('super_admin', 'zone_manager'),
  createInstitute
);

// PUT /api/institutes/:id - Update institute (FIX: THIS WAS MISSING)
router.put('/:id',
  authorizeRoles('super_admin', 'zone_manager'),
  updateInstitute
);

// PUT /api/institutes/:id/status - Toggle institute status (FIX: THIS WAS MISSING)
router.put('/:id/status',
  authorizeRoles('super_admin', 'zone_manager'),
  updateInstituteStatus
);

// DELETE /api/institutes/:id - Delete single institute (FIX: THIS WAS MISSING)
router.delete('/:id',
  authorizeRoles('super_admin', 'zone_manager'),
  deleteInstitute
);

// DELETE /api/institutes/bulk - Bulk delete institutes (FIX: THIS WAS MISSING)
router.delete('/bulk',
  authorizeRoles('super_admin', 'zone_manager'),
  bulkDeleteInstitutes
);

module.exports = router;