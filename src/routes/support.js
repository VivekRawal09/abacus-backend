const express = require('express');
const router = express.Router();
const SupportController = require('../controllers/support');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// 1. GET /api/support/tickets - Get support tickets (filtered by role)
router.get('/tickets', 
  SupportController.getTickets
);

// 2. POST /api/support/tickets - Create new support ticket
router.post('/tickets',
  SupportController.createTicket
);

// 3. GET /api/support/tickets/:id - Get specific ticket details
router.get('/tickets/:id',
  SupportController.getTicketById
);

// 4. PUT /api/support/tickets/:id - Update ticket (status, notes, etc.)
router.put('/tickets/:id',
  SupportController.updateTicket
);

// 5. GET /api/support/faq - Get FAQ content (public access)
router.get('/faq',
  SupportController.getFAQ
);

// 6. POST /api/support/faq - Create FAQ entry (admin only)
router.post('/faq',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  SupportController.createFAQ
);

// 7. PUT /api/support/faq/:id - Update FAQ entry (admin only)
router.put('/faq/:id',
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  SupportController.updateFAQ
);

// ✅ Error handling middleware
router.use((error, req, res, next) => {
  console.error('🎧 Support route error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  if (error.message.includes('UUID') || error.message.includes('Invalid ID')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      timestamp: new Date().toISOString()
    });
  }

  res.status(500).json({
    success: false,
    message: 'Support system error',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;