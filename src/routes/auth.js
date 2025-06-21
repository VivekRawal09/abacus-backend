const express = require('express');
const router = express.Router();
const { login, hashPassword } = require('../controllers/auth');

// Public routes
router.post('/login', login);
router.post('/hash', hashPassword); // Temporary for testing

module.exports = router;