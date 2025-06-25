const express = require('express');
const router = express.Router();
const { login, getProfile } = require('../controllers/auth');
const { authenticateToken } = require('../middleware/auth');

// Public routes
router.post('/login', login);

// Protected routes
router.get('/profile', authenticateToken, getProfile);

module.exports = router;