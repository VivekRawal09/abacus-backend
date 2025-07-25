const express = require('express');
const router = express.Router();
const AchievementsController = require('../controllers/achievements');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

router.use(authenticateToken);

// 6. GET /api/gamification/leaderboard
router.get('/leaderboard', AchievementsController.getLeaderboard);

// 7. POST /api/gamification/points  
router.post('/points', 
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  AchievementsController.awardPoints
);

module.exports = router;