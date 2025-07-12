const { supabase } = require('../config/database');
const { formatSuccessResponse, formatErrorResponse, formatPaginationResponse } = require('../utils/responseUtils');

class NotificationController {

  // ✅ 1. GET /api/notifications - Get user notifications
  static async getUserNotifications(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        is_read, 
        category, 
        notification_type 
      } = req.query;

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });

      // Apply filters
      if (is_read !== undefined) {
        query = query.eq('is_read', is_read === 'true');
      }

      if (category) {
        query = query.eq('category', category);
      }

      if (notification_type) {
        query = query.eq('notification_type', notification_type);
      }

      // Get total count for pagination
      const { count, error: countError } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id);

      if (countError) throw countError;

      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.range(offset, offset + parseInt(limit) - 1);

      const { data: notifications, error } = await query;

      if (error) throw error;

      // Get unread count
      const { count: unreadCount, error: unreadError } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('is_read', false);

      if (unreadError) throw unreadError;

      res.json(formatPaginationResponse(
        notifications,
        page,
        limit,
        count,
        { unread_count: unreadCount }
      ));

    } catch (error) {
      console.error('Get user notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 2. POST /api/notifications - Send notification (admin only)
  static async sendNotification(req, res) {
    try {
      const {
        user_id,
        title,
        message,
        notification_type = 'general',
        category = null,
        priority = 'medium',
        action_url = null
      } = req.body;

      // ✅ INPUT VALIDATION
      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: 'user_id is required'
        });
      }

      if (!title || title.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'title is required'
        });
      }

      if (!message || message.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'message is required'
        });
      }

      if (title.length > 255) {
        return res.status(400).json({
          success: false,
          message: 'title must be 255 characters or less'
        });
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(user_id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user_id format'
        });
      }

      // Validate notification_type
      const validTypes = ['general', 'assignment', 'reminder', 'system', 'achievement'];
      if (!validTypes.includes(notification_type)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification_type'
        });
      }

      // Validate priority
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid priority'
        });
      }

      // Verify target user exists
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, role, institute_id, zone_id')
        .eq('id', user_id)
        .eq('status', 'active')
        .single();

      if (userError || !user) {
        console.error('User lookup error:', userError);
        return res.status(400).json({
          success: false,
          message: 'Target user not found or inactive'
        });
      }

      // ✅ FIXED: Use static method correctly
      if (!NotificationController.canSendToUser(req.user, user)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to send notification to this user'
        });
      }

      // Create notification
      const { data: notification, error } = await supabase
        .from('notifications')
        .insert([{
          user_id,
          title: title.trim(),
          message: message.trim(),
          notification_type,
          category,
          priority,
          action_url,
          is_read: false
        }])
        .select()
        .single();

      if (error) {
        console.error('Notification insert error:', error);
        throw error;
      }

      res.status(201).json(formatSuccessResponse(notification, 'Notification sent successfully'));

    } catch (error) {
      console.error('Send notification error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send notification',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 3. PUT /api/notifications/:id/read - Mark notification as read
  static async markAsRead(req, res) {
    try {
      const { id } = req.params;

      // Validate ID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification ID format'
        });
      }

      const { data: notification, error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', req.user.id) // Users can only mark their own notifications
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Notification not found'
          });
        }
        throw error;
      }

      res.json(formatSuccessResponse(notification, 'Notification marked as read'));

    } catch (error) {
      console.error('Mark notification as read error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 4. DELETE /api/notifications/:id - Delete notification
  static async deleteNotification(req, res) {
    try {
      const { id } = req.params;

      // Validate ID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid notification ID format'
        });
      }

      const { data: notification, error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', id)
        .eq('user_id', req.user.id) // Users can only delete their own notifications
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Notification not found'
          });
        }
        throw error;
      }

      res.json(formatSuccessResponse(null, 'Notification deleted successfully'));

    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete notification',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 5. GET /api/notifications/templates - Get notification templates (admin)
  static async getNotificationTemplates(req, res) {
    try {
      // For now, return hardcoded templates since notification_templates table may not exist
      const templates = [
        {
          id: '1',
          name: 'Assignment Reminder',
          category: 'assignment',
          notification_type: 'reminder',
          title_template: 'Assignment Due: {{assignment_name}}',
          message_template: 'Your assignment "{{assignment_name}}" is due on {{due_date}}. Please complete it soon.',
          is_active: true
        },
        {
          id: '2',
          name: 'Welcome Message',
          category: 'general',
          notification_type: 'general',
          title_template: 'Welcome to ABACUS Learning Platform',
          message_template: 'Hello {{user_name}}, welcome to our learning platform!',
          is_active: true
        },
        {
          id: '3',
          name: 'Achievement Unlock',
          category: 'achievement',
          notification_type: 'achievement',
          title_template: 'Achievement Unlocked: {{achievement_name}}',
          message_template: 'Congratulations! You have unlocked the "{{achievement_name}}" achievement.',
          is_active: true
        }
      ];

      res.json(formatSuccessResponse(templates, 'Notification templates retrieved successfully'));

    } catch (error) {
      console.error('Get notification templates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notification templates',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 6. POST /api/notifications/bulk - Send bulk notifications (admin)
  static async sendBulkNotifications(req, res) {
    try {
      const {
        user_ids,
        template_id,
        title,
        message,
        notification_type = 'general',
        category = null,
        priority = 'medium',
        variables = {}
      } = req.body;

      let finalTitle = title;
      let finalMessage = message;
      let targetUserIds = user_ids;

      // ✅ INPUT VALIDATION
      if (!title && !template_id) {
        return res.status(400).json({
          success: false,
          message: 'Either title/message or template_id is required'
        });
      }

      if (!message && !template_id) {
        return res.status(400).json({
          success: false,
          message: 'Either title/message or template_id is required'
        });
      }

      // If using template, get template data (simplified for now)
      if (template_id) {
        const templates = {
          '1': {
            title_template: 'Assignment Due: {{assignment_name}}',
            message_template: 'Your assignment "{{assignment_name}}" is due on {{due_date}}. Please complete it soon.'
          },
          '2': {
            title_template: 'Welcome to ABACUS Learning Platform',
            message_template: 'Hello {{user_name}}, welcome to our learning platform!'
          }
        };

        const template = templates[template_id];
        if (!template) {
          return res.status(400).json({
            success: false,
            message: 'Template not found'
          });
        }

        // Replace variables in template
        finalTitle = NotificationController.replaceVariables(template.title_template, variables);
        finalMessage = NotificationController.replaceVariables(template.message_template, variables);

        // If no user_ids provided, get all users based on sender's permissions
        if (!user_ids) {
          targetUserIds = await NotificationController.getTargetUserIds(req.user);
        }
      }

      if (!targetUserIds || targetUserIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No target users specified'
        });
      }

      // Verify all target users exist and sender has permission
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, role, institute_id, zone_id')
        .in('id', targetUserIds)
        .eq('status', 'active');

      if (usersError) throw usersError;

      // ✅ FIXED: Use static method correctly
      const allowedUsers = users.filter(user => NotificationController.canSendToUser(req.user, user));

      if (allowedUsers.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'No permission to send notifications to specified users'
        });
      }

      // Create notification records
      const notifications = allowedUsers.map(user => ({
        user_id: user.id,
        title: finalTitle,
        message: finalMessage,
        notification_type,
        category,
        priority,
        is_read: false
      }));

      // Insert in batches of 100
      let insertedCount = 0;
      const batchSize = 100;

      for (let i = 0; i < notifications.length; i += batchSize) {
        const batch = notifications.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('notifications')
          .insert(batch);

        if (insertError) {
          console.error('Batch insert error:', insertError);
          continue;
        }

        insertedCount += batch.length;
      }

      res.status(201).json(formatSuccessResponse({
        notifications_sent: insertedCount,
        failed_sends: allowedUsers.length - insertedCount,
        target_users: allowedUsers.length
      }, 'Bulk notifications sent successfully'));

    } catch (error) {
      console.error('Send bulk notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send bulk notifications',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ FIXED: Helper method to check if sender can send notification to target user
  static canSendToUser(sender, targetUser) {
    // Super admin can send to anyone
    if (sender.role === 'super_admin') {
      return true;
    }

    // Zone manager can send to users in their zone
    if (sender.role === 'zone_manager' && sender.zone_id === targetUser.zone_id) {
      return true;
    }

    // Institute admin can send to users in their institute
    if (sender.role === 'institute_admin' && sender.institute_id === targetUser.institute_id) {
      return true;
    }

    return false;
  }

  // ✅ FIXED: Helper method to replace variables in template
  static replaceVariables(template, variables) {
    let result = template;
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    });
    return result;
  }

  // ✅ FIXED: Helper method to get target user IDs based on sender permissions
  static async getTargetUserIds(sender) {
    let query = supabase
      .from('users')
      .select('id')
      .eq('status', 'active');

    if (sender.role === 'zone_manager') {
      query = query.eq('zone_id', sender.zone_id);
    } else if (sender.role === 'institute_admin') {
      query = query.eq('institute_id', sender.institute_id);
    }

    const { data: users, error } = await query;
    
    if (error) {
      console.error('Get target users error:', error);
      return [];
    }

    return users.map(user => user.id);
  }
}

module.exports = NotificationController;