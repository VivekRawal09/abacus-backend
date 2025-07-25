const { supabase } = require('../config/database');

class SupportController {

  // 1. GET /api/support/tickets - Get support tickets (role-based filtering)
  static async getTickets(req, res) {
    try {
      const { page = 1, limit = 20, status, category, priority } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('support_tickets')
        .select(`
          id, ticket_number, subject, category, priority, status,
          platform, created_at, updated_at, resolved_at
        `, { count: 'exact' });

      // ✅ Role-based filtering
      if (req.user.role === 'student' || req.user.role === 'parent') {
        query = query.eq('user_id', req.user.id);
      }

      // Apply filters
      if (status) query = query.eq('status', status);
      if (category) query = query.eq('category', category);
      if (priority) query = query.eq('priority', priority);

      // Pagination and ordering
      const { data: tickets, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        success: true,
        data: {
          tickets: tickets || [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get tickets error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch support tickets'
      });
    }
  }

  // 2. POST /api/support/tickets - Create new support ticket
  static async createTicket(req, res) {
    try {
      const {
        subject,
        description,
        category = 'general',
        priority = 'medium',
        platform = 'web',
        device_info = {}
      } = req.body;

      // Validation
      if (!subject || !description) {
        return res.status(400).json({
          success: false,
          message: 'Subject and description are required'
        });
      }

      if (subject.length < 5 || description.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Subject must be at least 5 characters, description at least 10 characters'
        });
      }

      // Generate ticket number
      const ticketNumber = `TICKET-${Date.now()}`;

      // Get student_id if user is a student
      let studentId = null;
      if (req.user.role === 'student') {
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        studentId = student?.id;
      }

      // Create ticket
      const { data: ticket, error } = await supabase
        .from('support_tickets')
        .insert([{
          ticket_number: ticketNumber,
          user_id: req.user.id,
          student_id: studentId,
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          platform,
          device_info,
          app_version: req.headers['x-app-version'] || null,
          status: 'open'
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: ticket,
        message: 'Support ticket created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create ticket error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create support ticket'
      });
    }
  }

  // 3. GET /api/support/tickets/:id - Get specific ticket details
  static async getTicketById(req, res) {
    try {
      const { id } = req.params;

      let query = supabase
        .from('support_tickets')
        .select('*')
        .eq('id', id);

      // ✅ Access control: users can only see their own tickets
      if (req.user.role === 'student' || req.user.role === 'parent') {
        query = query.eq('user_id', req.user.id);
      }

      const { data: ticket, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Ticket not found'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        data: ticket,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get ticket by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch ticket details'
      });
    }
  }

  // 4. PUT /api/support/tickets/:id - Update ticket
  static async updateTicket(req, res) {
    try {
      const { id } = req.params;
      const {
        status,
        priority,
        assigned_to,
        resolution_notes,
        customer_rating,
        customer_feedback
      } = req.body;

      // Check if ticket exists and user has access
      let query = supabase
        .from('support_tickets')
        .select('id, user_id, status')
        .eq('id', id);

      if (req.user.role === 'student' || req.user.role === 'parent') {
        query = query.eq('user_id', req.user.id);
      }

      const { data: existingTicket, error: fetchError } = await query.single();

      if (fetchError || !existingTicket) {
        return res.status(404).json({
          success: false,
          message: 'Ticket not found'
        });
      }

      // Prepare update data
      const updateData = { updated_at: new Date().toISOString() };

      // Admin can update status, priority, assignment, resolution
      if (['super_admin', 'zone_manager', 'institute_admin'].includes(req.user.role)) {
        if (status) updateData.status = status;
        if (priority) updateData.priority = priority;
        if (assigned_to) updateData.assigned_to = assigned_to;
        if (resolution_notes) updateData.resolution_notes = resolution_notes;
        if (status === 'resolved' || status === 'closed') {
          updateData.resolved_at = new Date().toISOString();
          updateData.resolved_by = req.user.id;
        }
      }

      // Users can provide feedback and rating
      if (customer_rating) updateData.customer_rating = customer_rating;
      if (customer_feedback) updateData.customer_feedback = customer_feedback;

      // Update ticket
      const { data: updatedTicket, error } = await supabase
        .from('support_tickets')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: updatedTicket,
        message: 'Ticket updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Update ticket error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update ticket'
      });
    }
  }

  // 5. GET /api/support/faq - Get FAQ content
  static async getFAQ(req, res) {
    try {
      const { category, search, limit = 50 } = req.query;

      let query = supabase
        .from('faq_content')
        .select('*')
        .eq('is_active', true);

      // Apply filters
      if (category) query = query.eq('category', category);
      if (search) {
        query = query.or(`question.ilike.%${search}%,answer.ilike.%${search}%`);
      }

      const { data: faqs, error } = await query
        .order('order_index', { ascending: true })
        .order('helpful_count', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Get categories for navigation
      const { data: categories } = await supabase
        .from('faq_content')
        .select('category')
        .eq('is_active', true)
        .neq('category', null);

      const uniqueCategories = [...new Set(categories?.map(c => c.category) || [])];

      res.json({
        success: true,
        data: {
          faqs: faqs || [],
          categories: uniqueCategories,
          total: faqs?.length || 0
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get FAQ error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch FAQ'
      });
    }
  }

  // 6. POST /api/support/faq - Create FAQ entry (admin only)
  static async createFAQ(req, res) {
    try {
      const {
        question,
        answer,
        category = 'general',
        order_index = 0,
        is_featured = false
      } = req.body;

      // Validation
      if (!question || !answer) {
        return res.status(400).json({
          success: false,
          message: 'Question and answer are required'
        });
      }

      if (question.length < 10 || answer.length < 20) {
        return res.status(400).json({
          success: false,
          message: 'Question must be at least 10 characters, answer at least 20 characters'
        });
      }

      // Create FAQ
      const { data: faq, error } = await supabase
        .from('faq_content')
        .insert([{
          question: question.trim(),
          answer: answer.trim(),
          category,
          order_index,
          is_featured,
          is_active: true
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: faq,
        message: 'FAQ created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create FAQ error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create FAQ'
      });
    }
  }

  // 7. PUT /api/support/faq/:id - Update FAQ entry (admin only)
  static async updateFAQ(req, res) {
    try {
      const { id } = req.params;
      const {
        question,
        answer,
        category,
        order_index,
        is_featured,
        is_active
      } = req.body;

      // Check if FAQ exists
      const { data: existingFAQ, error: fetchError } = await supabase
        .from('faq_content')
        .select('id')
        .eq('id', id)
        .single();

      if (fetchError || !existingFAQ) {
        return res.status(404).json({
          success: false,
          message: 'FAQ not found'
        });
      }

      // Prepare update data
      const updateData = { updated_at: new Date().toISOString() };
      if (question) updateData.question = question.trim();
      if (answer) updateData.answer = answer.trim();
      if (category) updateData.category = category;
      if (order_index !== undefined) updateData.order_index = order_index;
      if (is_featured !== undefined) updateData.is_featured = is_featured;
      if (is_active !== undefined) updateData.is_active = is_active;

      // Update FAQ
      const { data: updatedFAQ, error } = await supabase
        .from('faq_content')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: updatedFAQ,
        message: 'FAQ updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Update FAQ error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update FAQ'
      });
    }
  }
}

module.exports = SupportController;