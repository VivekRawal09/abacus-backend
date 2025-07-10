const { supabase } = require('../config/database');

class LessonsController {

  // 1. GET /api/lessons - List all lessons
  static async getAllLessons(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        course_id, 
        lesson_type, 
        difficulty_level,
        search 
      } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('lessons')
        .select(`
          *,
          courses:course_id(name, level_number),
          lesson_content(count)
        `);

      // Apply filters
      if (course_id) query = query.eq('course_id', course_id);
      if (lesson_type) query = query.eq('lesson_type', lesson_type);
      if (difficulty_level) query = query.eq('difficulty_level', difficulty_level);
      if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      }

      // Only show active lessons
      query = query.eq('is_active', true);

      const { data: lessons, error } = await query
        .range(offset, offset + parseInt(limit) - 1)
        .order('course_id')
        .order('lesson_number');

      if (error) throw error;

      // Get total count
      const { count: totalCount } = await supabase
        .from('lessons')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      res.json({
        success: true,
        data: {
          lessons: lessons || [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil((totalCount || 0) / limit),
            totalLessons: totalCount || 0,
            hasNextPage: (totalCount || 0) > offset + limit,
            limit: parseInt(limit)
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get lessons error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lessons'
      });
    }
  }

  // 2. POST /api/lessons - Create lesson (admin only)
  static async createLesson(req, res) {
    try {
      const {
        course_id,
        title,
        description,
        lesson_number,
        lesson_type = 'video',
        estimated_duration_minutes = 15,
        learning_objectives = [],
        prerequisite_lessons = [],
        is_mandatory = true,
        difficulty_level = 'beginner',
        tags = [],
        thumbnail_url
      } = req.body;

      // Validation
      if (!course_id || !title || !description) {
        return res.status(400).json({
          success: false,
          message: 'Course ID, title, and description are required'
        });
      }

      // Check if course exists
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('id')
        .eq('id', course_id)
        .single();

      if (courseError || !course) {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      // Auto-generate lesson number if not provided
      let finalLessonNumber = lesson_number;
      if (!lesson_number) {
        const { data: lastLesson } = await supabase
          .from('lessons')
          .select('lesson_number')
          .eq('course_id', course_id)
          .order('lesson_number', { ascending: false })
          .limit(1)
          .single();

        finalLessonNumber = (lastLesson?.lesson_number || 0) + 1;
      }

      // Create lesson
      const { data: lesson, error } = await supabase
        .from('lessons')
        .insert([{
          course_id,
          title,
          description,
          lesson_number: finalLessonNumber,
          lesson_type,
          estimated_duration_minutes,
          learning_objectives,
          prerequisite_lessons,
          is_mandatory,
          difficulty_level,
          tags,
          thumbnail_url,
          is_active: true
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: lesson,
        message: 'Lesson created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Create lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create lesson'
      });
    }
  }

  // 3. GET /api/lessons/:id - Get lesson details
  static async getLessonById(req, res) {
    try {
      const { id } = req.params;

      const { data: lesson, error } = await supabase
        .from('lessons')
        .select(`
          *,
          courses:course_id(id, name, level_number, difficulty_level),
          lesson_content(*)
        `)
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Lesson not found'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        data: lesson,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lesson'
      });
    }
  }

  // 4. PUT /api/lessons/:id - Update lesson (admin only)
  static async updateLesson(req, res) {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        lesson_number,
        lesson_type,
        estimated_duration_minutes,
        learning_objectives,
        prerequisite_lessons,
        is_mandatory,
        difficulty_level,
        tags,
        thumbnail_url
      } = req.body;

      // Check if lesson exists
      const { data: existingLesson, error: checkError } = await supabase
        .from('lessons')
        .select('id')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (checkError || !existingLesson) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Build update object
      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (lesson_number !== undefined) updateData.lesson_number = lesson_number;
      if (lesson_type !== undefined) updateData.lesson_type = lesson_type;
      if (estimated_duration_minutes !== undefined) updateData.estimated_duration_minutes = estimated_duration_minutes;
      if (learning_objectives !== undefined) updateData.learning_objectives = learning_objectives;
      if (prerequisite_lessons !== undefined) updateData.prerequisite_lessons = prerequisite_lessons;
      if (is_mandatory !== undefined) updateData.is_mandatory = is_mandatory;
      if (difficulty_level !== undefined) updateData.difficulty_level = difficulty_level;
      if (tags !== undefined) updateData.tags = tags;
      if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;

      // Update lesson
      const { data: lesson, error } = await supabase
        .from('lessons')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: lesson,
        message: 'Lesson updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update lesson'
      });
    }
  }

  // 5. DELETE /api/lessons/:id - Delete lesson (admin only)
  static async deleteLesson(req, res) {
    try {
      const { id } = req.params;

      // Check if lesson exists
      const { data: existingLesson, error: checkError } = await supabase
        .from('lessons')
        .select('id, title')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (checkError || !existingLesson) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Soft delete (set is_active to false)
      const { error } = await supabase
        .from('lessons')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      res.json({
        success: true,
        message: 'Lesson deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Delete lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete lesson'
      });
    }
  }

  // 6. GET /api/lessons/:id/content - Get lesson content
  static async getLessonContent(req, res) {
    try {
      const { id } = req.params;

      // Check if lesson exists
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('id, title')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (lessonError || !lesson) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Get lesson content
      const { data: content, error } = await supabase
        .from('lesson_content')
        .select('*')
        .eq('lesson_id', id)
        .order('content_order');

      if (error) throw error;

      res.json({
        success: true,
        data: {
          lesson_id: id,
          lesson_title: lesson.title,
          content: content || [],
          total_content_items: content?.length || 0,
          total_points: content?.reduce((sum, item) => sum + (item.points_awarded || 0), 0) || 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get lesson content error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lesson content'
      });
    }
  }

  // 7. POST /api/lessons/:id/content - Add lesson content (admin only)
  static async addLessonContent(req, res) {
    try {
      const { id } = req.params;
      const {
        content_type,
        content_id,
        content_order,
        is_mandatory = true,
        points_awarded = 10
      } = req.body;

      // Validation
      if (!content_type || !content_id) {
        return res.status(400).json({
          success: false,
          message: 'Content type and content ID are required'
        });
      }

      // Check if lesson exists
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('id')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (lessonError || !lesson) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Auto-generate content order if not provided
      let finalOrder = content_order;
      if (!content_order) {
        const { data: lastContent } = await supabase
          .from('lesson_content')
          .select('content_order')
          .eq('lesson_id', id)
          .order('content_order', { ascending: false })
          .limit(1)
          .single();

        finalOrder = (lastContent?.content_order || 0) + 1;
      }

      // Add content
      const { data: content, error } = await supabase
        .from('lesson_content')
        .insert([{
          lesson_id: id,
          content_type,
          content_id,
          content_order: finalOrder,
          is_mandatory,
          points_awarded
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: content,
        message: 'Lesson content added successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Add lesson content error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add lesson content'
      });
    }
  }

  // 8. PUT /api/lessons/:id/content/:contentId - Update lesson content (admin only)
  static async updateLessonContent(req, res) {
    try {
      const { id, contentId } = req.params;
      const {
        content_type,
        content_id,
        content_order,
        is_mandatory,
        points_awarded
      } = req.body;

      // Check if content exists
      const { data: existingContent, error: checkError } = await supabase
        .from('lesson_content')
        .select('id')
        .eq('id', contentId)
        .eq('lesson_id', id)
        .single();

      if (checkError || !existingContent) {
        return res.status(404).json({
          success: false,
          message: 'Lesson content not found'
        });
      }

      // Build update object
      const updateData = {};
      if (content_type !== undefined) updateData.content_type = content_type;
      if (content_id !== undefined) updateData.content_id = content_id;
      if (content_order !== undefined) updateData.content_order = content_order;
      if (is_mandatory !== undefined) updateData.is_mandatory = is_mandatory;
      if (points_awarded !== undefined) updateData.points_awarded = points_awarded;

      // Update content
      const { data: content, error } = await supabase
        .from('lesson_content')
        .update(updateData)
        .eq('id', contentId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: content,
        message: 'Lesson content updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update lesson content error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update lesson content'
      });
    }
  }
}

module.exports = LessonsController;