const express = require('express');
const router = express.Router();
const { getAllZones } = require('../controllers/zones');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken); // Require authentication for all zone routes

router.get('/', getAllZones);

module.exports = router;