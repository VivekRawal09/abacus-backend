const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notifications');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// ✅ 1. GET /api/notifications - Get user notifications
router.get('/',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { page, limit, is_read, category, notification_type } = req.query;
    
    if (page && (isNaN(page) || parseInt(page) < 1)) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive number'
      });
    }
    
    if (limit && (isNaN(limit) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100'
      });
    }
    
    if (is_read && !['true', 'false'].includes(is_read)) {
      return res.status(400).json({
        success: false,
        message: 'is_read must be true or false'
      });
    }
    
    const validCategories = ['academic', 'system', 'payment', 'achievement', 'mobile_app'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Valid options: academic, system, payment, achievement, mobile_app'
      });
    }
    
    const validTypes = ['general', 'info', 'warning', 'success', 'error'];
    if (notification_type && !validTypes.includes(notification_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification type. Valid options: general, info, warning, success, error'
      });
    }
    
    next();
  },
  NotificationController.getUserNotifications
);

// ✅ 2. POST /api/notifications - Send notification (admin only)
router.post('/',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { user_id, title, message, notification_type = 'general' } = req.body;
    
    if (!user_id || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: user_id, title, message'
      });
    }
    
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }
    
    if (title.length > 255) {
      return res.status(400).json({
        success: false,
        message: 'Title must be 255 characters or less'
      });
    }
    
    const validTypes = ['general', 'info', 'warning', 'success', 'error'];
    if (!validTypes.includes(notification_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification type. Valid options: general, info, warning, success, error'
      });
    }
    
    next();
  },
  NotificationController.sendNotification
);

// ✅ 3. PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }
    next();
  },
  NotificationController.markAsRead
);

// ✅ 4. DELETE /api/notifications/:id - Delete notification
router.delete('/:id',
  authenticateToken,
  authorizeRoles('student', 'parent', 'super_admin', 'zone_manager', 'institute_admin'),
  // UUID validation
  (req, res, next) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }
    next();
  },
  NotificationController.deleteNotification
);

// ✅ 5. GET /api/notifications/templates - Get notification templates (admin)
router.get('/templates',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { category, notification_type, is_active } = req.query;
    
    const validCategories = ['academic', 'system', 'payment', 'achievement', 'mobile_app'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Valid options: academic, system, payment, achievement, mobile_app'
      });
    }
    
    const validTypes = ['general', 'info', 'warning', 'success', 'error'];
    if (notification_type && !validTypes.includes(notification_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification type. Valid options: general, info, warning, success, error'
      });
    }
    
    if (is_active && !['true', 'false'].includes(is_active)) {
      return res.status(400).json({
        success: false,
        message: 'is_active must be true or false'
      });
    }
    
    next();
  },
  NotificationController.getNotificationTemplates
);

// ✅ 6. POST /api/notifications/bulk - Send bulk notifications (admin)
router.post('/bulk',
  authenticateToken,
  authorizeRoles('super_admin', 'zone_manager', 'institute_admin'),
  // Validation middleware
  (req, res, next) => {
    const { 
      user_ids, 
      template_id, 
      title, 
      message, 
      notification_type = 'general',
      variables = {}
    } = req.body;
    
    // Must provide either user_ids array or template_id
    if (!user_ids && !template_id) {
      return res.status(400).json({
        success: false,
        message: 'Either user_ids array or template_id is required'
      });
    }
    
    // If using direct message, title and message are required
    if (user_ids && (!title || !message)) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required when sending to specific users'
      });
    }
    
    // Validate user_ids array
    if (user_ids && Array.isArray(user_ids)) {
      if (user_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'user_ids array cannot be empty'
        });
      }
      
      if (user_ids.length > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Cannot send to more than 1000 users at once'
        });
      }
      
      // Validate UUID format for each user_id
      const invalidIds = user_ids.filter(id => 
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      );
      
      if (invalidIds.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID format in array'
        });
      }
    }
    
    // Validate template_id if provided
    if (template_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(template_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template ID format'
      });
    }
    
    const validTypes = ['general', 'info', 'warning', 'success', 'error'];
    if (!validTypes.includes(notification_type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification type. Valid options: general, info, warning, success, error'
      });
    }
    
    next();
  },
  NotificationController.sendBulkNotifications
);

module.exports = router;