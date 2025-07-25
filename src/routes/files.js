const express = require('express');
const router = express.Router();
const multer = require('multer');
const FilesController = require('../controllers/files');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// ✅ Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 files for bulk upload
  },
  fileFilter: (req, file, cb) => {
    // Allow specific file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// 1. POST /api/files/upload - Upload single file
router.post('/upload',
  upload.single('file'),
  FilesController.uploadFile
);

// 2. GET /api/files/:id - Get file details
router.get('/:id',
  FilesController.getFileDetails
);

// 3. DELETE /api/files/:id - Delete file
router.delete('/:id',
  FilesController.deleteFile
);

// 4. GET /api/files/:id/download - Download file
router.get('/:id/download',
  FilesController.downloadFile
);

// 5. POST /api/files/bulk-upload - Bulk file upload
router.post('/bulk-upload',
  upload.array('files', 5),
  FilesController.bulkUpload
);

// ✅ Multer error handling
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum 10MB allowed'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 5 files allowed'
      });
    }
  }

  if (error.message.includes('File type')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  console.error('📁 Files route error:', {
    error: error.message,
    userId: req.user?.id,
    path: req.path,
    timestamp: new Date().toISOString()
  });

  res.status(500).json({
    success: false,
    message: 'File processing error'
  });
});

module.exports = router;