const express = require("express");
const router = express.Router();
const AchievementsController = require("../controllers/achievements");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

// ✅ All routes require authentication
router.use(authenticateToken);

// Achievement Management Routes

// 1. GET /api/achievements - List all achievements
router.get("/", AchievementsController.getAllAchievements);

// 2. POST /api/achievements - Create new achievement (admin only)
router.post(
  "/",
  authorizeRoles("super_admin", "zone_manager", "institute_admin"),
  AchievementsController.createAchievement
);

// 3. GET /api/achievements/:id - Get specific achievement details
router.get("/:id", AchievementsController.getAchievementById);

// 4. PUT /api/achievements/:id - Update achievement (admin only)
router.put(
  "/:id",
  authorizeRoles("super_admin", "zone_manager", "institute_admin"),
  AchievementsController.updateAchievement
);

// 5. POST /api/achievements/:id/award - Award achievement to student
router.post(
  "/:id/award",
  authorizeRoles("super_admin", "zone_manager", "institute_admin"),
  AchievementsController.awardAchievement
);

// Gamification Routes (points & leaderboards)

// 6. GET /api/gamification/leaderboard - Get points leaderboard
router.get("/gamification/leaderboard", AchievementsController.getLeaderboard);


// 7. POST /api/gamification/points - Award points to student
router.post("/gamification/points", AchievementsController.awardPoints);

// ✅ Error handling middleware
router.use((error, req, res, next) => {
  console.error("🏆 Achievement route error:", {
    error: error.message,
    stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  if (error.message.includes("UUID") || error.message.includes("Invalid ID")) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
      timestamp: new Date().toISOString(),
    });
  }

  res.status(500).json({
    success: false,
    message: "Achievement system error",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
