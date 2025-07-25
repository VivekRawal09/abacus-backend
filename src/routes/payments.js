const express = require('express');
const router = express.Router();
const PaymentsController = require('../controllers/payments');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ All routes require authentication
router.use(authenticateToken);

// Subscription Plan Management

// 1. GET /api/payments/plans - Get subscription plans
router.get('/plans',
  PaymentsController.getSubscriptionPlans
);

// 2. POST /api/payments/plans - Create subscription plan (super admin only)
router.post('/plans',
  authorizeRoles('super_admin'),
  PaymentsController.createSubscriptionPlan
);

// Subscription Management

// 3. GET /api/payments/subscriptions/:userId - Get user subscriptions
router.get('/subscriptions/:userId',
  PaymentsController.getUserSubscriptions
);

// 4. POST /api/payments/subscribe - Create new subscription
router.post('/subscribe',
  PaymentsController.createSubscription
);

// 5. PUT /api/payments/subscriptions/:id/cancel - Cancel subscription
router.put('/subscriptions/:id/cancel',
  PaymentsController.cancelSubscription
);

// Payment Processing

// 6. GET /api/payments/transactions - Get payment transactions
router.get('/transactions',
  PaymentsController.getPaymentTransactions
);

// 7. POST /api/payments/process - Process payment
router.post('/process',
  PaymentsController.processPayment
);

// 8. GET /api/payments/:id/receipt - Get payment receipt
router.get('/:id/receipt',
  PaymentsController.getPaymentReceipt
);

// ✅ Error handling middleware
router.use((error, req, res, next) => {
  console.error('💰 Payment route error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  if (error.message.includes('Payment gateway')) {
    return res.status(502).json({
      success: false,
      message: 'Payment gateway error. Please try again later.',
      timestamp: new Date().toISOString()
    });
  }

  if (error.message.includes('Insufficient funds') || error.message.includes('Card declined')) {
    return res.status(402).json({
      success: false,
      message: 'Payment failed. Please check your payment method.',
      timestamp: new Date().toISOString()
    });
  }

  if (error.message.includes('UUID') || error.message.includes('Invalid ID')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format',
      timestamp: new Date().toISOString()
    });
  }

  res.status(500).json({
    success: false,
    message: 'Payment system error',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;