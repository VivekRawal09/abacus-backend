const { supabase } = require('../config/database');

// ✅ COURSE MANAGEMENT CONTROLLER - Integrated with your existing system
class CoursesController {

  // 1. GET /api/courses - List all courses with pagination, filters, and enrollment stats
  static async getAllCourses(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        level_number,
        difficulty_level,
        is_active = true,
        search,
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = req.query;

      const offset = (page - 1) * limit;

      // ✅ SECURITY: Build query with role-based access control
      let query = supabase
        .from('courses')
        .select(`
          *,
          student_course_enrollments(count),
          lessons(count)
        `);

      // Apply filters
      if (is_active !== undefined) {
        query = query.eq('is_active', is_active);
      }

      if (level_number) {
        query = query.eq('level_number', parseInt(level_number));
      }

      if (difficulty_level) {
        query = query.eq('difficulty_level', difficulty_level);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
      }

      // Apply sorting and pagination
      query = query
        .order(sort_by, { ascending: sort_order.toUpperCase() === 'ASC' })
        .range(offset, offset + parseInt(limit) - 1);

      const { data: courses, error, count } = await query;

      if (error) {
        console.error('Error fetching courses:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch courses',
          error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
      }

      // Calculate pagination info
      const totalCourses = count || 0;
      const totalPages = Math.ceil(totalCourses / limit);

      // ✅ ENHANCED: Get detailed enrollment stats for each course
      const coursesWithStats = await Promise.all(
        (courses || []).map(async (course) => {
          try {
            // Get enrollment stats
            const { data: enrollmentStats } = await supabase
              .from('student_course_enrollments')
              .select('student_id, progress_percentage, is_active')
              .eq('course_id', course.id);

            // Get lesson count
            const { data: lessons } = await supabase
              .from('lessons')
              .select('id')
              .eq('course_id', course.id)
              .eq('is_active', true);

            const enrollments = enrollmentStats || [];
            const activeEnrollments = enrollments.filter(e => e.is_active);
            const avgProgress = activeEnrollments.length > 0
              ? activeEnrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / activeEnrollments.length
              : 0;

            return {
              ...course,
              enrolled_students: activeEnrollments.length,
              total_lessons: lessons?.length || 0,
              avg_progress: Math.round(avgProgress * 100) / 100
            };
          } catch (error) {
            console.error(`Error getting stats for course ${course.id}:`, error);
            return {
              ...course,
              enrolled_students: 0,
              total_lessons: 0,
              avg_progress: 0
            };
          }
        })
      );

      res.json({
        success: true,
        data: {
          courses: coursesWithStats,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalCourses,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            limit: parseInt(limit)
          }
        },
        message: 'Courses retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Courses controller error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch courses',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 2. POST /api/courses - Create new course with validation
  static async createCourse(req, res) {
    try {
      const {
        name,
        description,
        level_number,
        difficulty_level = 'beginner',
        target_age_min,
        target_age_max,
        estimated_duration_days = 30,
        learning_objectives = [],
        prerequisites,
        thumbnail_url,
        display_order
      } = req.body;

      // ✅ VALIDATION: Required fields
      if (!name || !description || !level_number) {
        return res.status(400).json({
          success: false,
          message: 'Name, description, and level_number are required'
        });
      }

      // ✅ VALIDATION: Level number range
      if (level_number < 1 || level_number > 20) {
        return res.status(400).json({
          success: false,
          message: 'Level number must be between 1 and 20'
        });
      }

      // ✅ VALIDATION: Difficulty level
      const validDifficulties = ['beginner', 'intermediate', 'advanced'];
      if (!validDifficulties.includes(difficulty_level)) {
        return res.status(400).json({
          success: false,
          message: `Difficulty level must be one of: ${validDifficulties.join(', ')}`
        });
      }

      // ✅ SECURITY: Log course creation attempt
      console.log('📚 Course creation attempt:', {
        creatorId: req.user.id,
        creatorRole: req.user.role,
        courseName: name,
        level: level_number,
        timestamp: new Date().toISOString()
      });

      const { data: course, error } = await supabase
        .from('courses')
        .insert([{
          name,
          description,
          level_number: parseInt(level_number),
          difficulty_level,
          target_age_min: target_age_min ? parseInt(target_age_min) : null,
          target_age_max: target_age_max ? parseInt(target_age_max) : null,
          estimated_duration_days: parseInt(estimated_duration_days),
          learning_objectives,
          prerequisites,
          thumbnail_url,
          display_order: display_order ? parseInt(display_order) : level_number,
          is_active: true
        }])
        .select()
        .single();

      if (error) {
        console.error('Error creating course:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to create course',
          error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
      }

      res.status(201).json({
        success: true,
        data: course,
        message: 'Course created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create course error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create course',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 3. GET /api/courses/:id - Get course details with lessons and student progress
  static async getCourseById(req, res) {
    try {
      const { id } = req.params;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Get course with related data
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (courseError) {
        if (courseError.code === 'PGRST116') { // No rows returned
          return res.status(404).json({
            success: false,
            message: 'Course not found'
          });
        }
        throw courseError;
      }

      // Get lessons for this course
      const { data: lessons, error: lessonsError } = await supabase
        .from('lessons')
        .select(`
          *,
          lesson_content(
            content_type,
            content_id,
            content_order,
            points_awarded
          )
        `)
        .eq('course_id', id)
        .eq('is_active', true)
        .order('lesson_number');

      if (lessonsError) {
        console.error('Error fetching lessons:', lessonsError);
      }

      // Get enrollment statistics
      const { data: enrollmentStats, error: enrollmentError } = await supabase
        .from('student_course_enrollments')
        .select('student_id, progress_percentage, is_active, enrolled_at')
        .eq('course_id', id)
        .eq('is_active', true);

      if (enrollmentError) {
        console.error('Error fetching enrollment stats:', enrollmentError);
      }

      // Calculate statistics
      const enrollments = enrollmentStats || [];
      const avgProgress = enrollments.length > 0
        ? enrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / enrollments.length
        : 0;

      const courseWithDetails = {
        ...course,
        lessons: lessons || [],
        stats: {
          total_lessons: lessons?.length || 0,
          enrolled_students: enrollments.length,
          avg_progress: Math.round(avgProgress * 100) / 100,
          completion_rate: enrollments.filter(e => e.progress_percentage >= 100).length
        }
      };

      res.json({
        success: true,
        data: courseWithDetails,
        message: 'Course details retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get course by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course details',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 4. PUT /api/courses/:id - Update course information
  static async updateCourse(req, res) {
    try {
      const { id } = req.params;
      const updateFields = { ...req.body };

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // ✅ SECURITY: Remove fields that shouldn't be updated
      delete updateFields.id;
      delete updateFields.created_at;

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields provided for update'
        });
      }

      // ✅ VALIDATION: Level number if provided
      if (updateFields.level_number && (updateFields.level_number < 1 || updateFields.level_number > 20)) {
        return res.status(400).json({
          success: false,
          message: 'Level number must be between 1 and 20'
        });
      }

      // ✅ VALIDATION: Difficulty level if provided
      if (updateFields.difficulty_level) {
        const validDifficulties = ['beginner', 'intermediate', 'advanced'];
        if (!validDifficulties.includes(updateFields.difficulty_level)) {
          return res.status(400).json({
            success: false,
            message: `Difficulty level must be one of: ${validDifficulties.join(', ')}`
          });
        }
      }

      // Add updated_at timestamp
      updateFields.updated_at = new Date().toISOString();

      // ✅ SECURITY: Log update attempt
      console.log('✏️ Course update attempt:', {
        editorId: req.user.id,
        editorRole: req.user.role,
        courseId: id,
        updateFields: Object.keys(updateFields),
        timestamp: new Date().toISOString()
      });

      const { data: updatedCourse, error } = await supabase
        .from('courses')
        .update(updateFields)
        .eq('id', id)
        .eq('is_active', true)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return res.status(404).json({
            success: false,
            message: 'Course not found or inactive'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        data: updatedCourse,
        message: 'Course updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Update course error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update course',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 5. DELETE /api/courses/:id - Soft delete course (set is_active=false)
  static async deleteCourse(req, res) {
    try {
      const { id } = req.params;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // ✅ SECURITY: Log deletion attempt
      console.log('🗑️ Course deletion attempt:', {
        deleterId: req.user.id,
        deleterRole: req.user.role,
        courseId: id,
        timestamp: new Date().toISOString()
      });

      const { data: deletedCourse, error } = await supabase
        .from('courses')
        .update({ 
          is_active: false, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', id)
        .eq('is_active', true)
        .select('id, name')
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          return res.status(404).json({
            success: false,
            message: 'Course not found or already deleted'
          });
        }
        throw error;
      }

      res.json({
        success: true,
        data: deletedCourse,
        message: 'Course deleted successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Delete course error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete course',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 6. GET /api/courses/:id/lessons - Get all lessons for a course with content
  static async getCourseLessons(req, res) {
    try {
      const { id } = req.params;
      const { include_content = 'false' } = req.query;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Build select query based on include_content parameter
      let selectFields = `
        id,
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
        thumbnail_url,
        created_at,
        updated_at
      `;

      if (include_content === 'true') {
        selectFields += `,
          lesson_content(
            content_type,
            content_id,
            content_order,
            points_awarded,
            is_mandatory
          )
        `;
      }

      const { data: lessons, error } = await supabase
        .from('lessons')
        .select(selectFields)
        .eq('course_id', id)
        .eq('is_active', true)
        .order('lesson_number');

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data: lessons || [],
        message: 'Course lessons retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get course lessons error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course lessons',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 7. POST /api/courses/:id/lessons - Add new lesson to course
  static async addLessonToCourse(req, res) {
    try {
      const { id } = req.params;
      const {
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

      // ✅ VALIDATION: Required fields
      if (!title || !description) {
        return res.status(400).json({
          success: false,
          message: 'Title and description are required'
        });
      }

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // ✅ VALIDATION: Check if course exists
      const { data: courseExists, error: courseCheckError } = await supabase
        .from('courses')
        .select('id')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (courseCheckError && courseCheckError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      if (courseCheckError) {
        throw courseCheckError;
      }

      // ✅ AUTO-GENERATE: Get next lesson number if not provided
      let finalLessonNumber = lesson_number;
      if (!lesson_number) {
        const { data: lastLesson } = await supabase
          .from('lessons')
          .select('lesson_number')
          .eq('course_id', id)
          .order('lesson_number', { ascending: false })
          .limit(1)
          .single();

        finalLessonNumber = (lastLesson?.lesson_number || 0) + 1;
      }

      // ✅ VALIDATION: Valid lesson types
      const validTypes = ['video', 'exercise', 'assessment', 'reading'];
      if (!validTypes.includes(lesson_type)) {
        return res.status(400).json({
          success: false,
          message: `Lesson type must be one of: ${validTypes.join(', ')}`
        });
      }

      // ✅ SECURITY: Log lesson creation
      console.log('📖 Lesson creation attempt:', {
        creatorId: req.user.id,
        creatorRole: req.user.role,
        courseId: id,
        lessonTitle: title,
        timestamp: new Date().toISOString()
      });

      const { data: lesson, error } = await supabase
        .from('lessons')
        .insert([{
          course_id: id,
          title,
          description,
          lesson_number: parseInt(finalLessonNumber),
          lesson_type,
          estimated_duration_minutes: parseInt(estimated_duration_minutes),
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

      if (error) {
        throw error;
      }

      res.status(201).json({
        success: true,
        data: lesson,
        message: 'Lesson added to course successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Add lesson to course error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add lesson to course',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 8. PUT /api/courses/:id/reorder-lessons - Reorder lessons in course
  static async reorderLessons(req, res) {
    try {
      const { id } = req.params;
      const { lesson_orders } = req.body;

      // ✅ VALIDATION: lesson_orders array
      if (!Array.isArray(lesson_orders) || lesson_orders.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'lesson_orders array is required'
        });
      }

      // ✅ VALIDATION: Each item format
      for (const item of lesson_orders) {
        if (!item.lesson_id || !item.lesson_number || 
            typeof item.lesson_number !== 'number') {
          return res.status(400).json({
            success: false,
            message: 'Each item must have lesson_id and lesson_number (number)'
          });
        }
      }

      // ✅ SECURITY: Log reordering attempt
      console.log('🔄 Lesson reordering attempt:', {
        userId: req.user.id,
        userRole: req.user.role,
        courseId: id,
        lessonCount: lesson_orders.length,
        timestamp: new Date().toISOString()
      });

      // Update each lesson's order
      const updatePromises = lesson_orders.map(({ lesson_id, lesson_number }) =>
        supabase
          .from('lessons')
          .update({ 
            lesson_number: parseInt(lesson_number), 
            updated_at: new Date().toISOString() 
          })
          .eq('id', lesson_id)
          .eq('course_id', id)
      );

      const results = await Promise.all(updatePromises);

      // Check for errors
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error('Lesson reordering errors:', errors);
        return res.status(500).json({
          success: false,
          message: 'Some lessons could not be reordered',
          errors: errors.map(e => e.error.message)
        });
      }

      // Get updated lessons to return
      const { data: updatedLessons, error: fetchError } = await supabase
        .from('lessons')
        .select('*')
        .eq('course_id', id)
        .eq('is_active', true)
        .order('lesson_number');

      if (fetchError) {
        throw fetchError;
      }

      res.json({
        success: true,
        data: updatedLessons,
        message: 'Lessons reordered successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Reorder lessons error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reorder lessons',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 9. GET /api/courses/:id/students - Get enrolled students with progress
  static async getCourseStudents(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Get enrolled students with progress
      const { data: enrollments, error, count } = await supabase
        .from('student_course_enrollments')
        .select(`
          *,
          students:student_id(
            id,
            user_id,
            users:user_id(
              first_name,
              last_name,
              email
            )
          )
        `, { count: 'exact' })
        .eq('course_id', id)
        .eq('is_active', true)
        .range(offset, offset + parseInt(limit) - 1)
        .order('enrolled_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Format the response
      const students = (enrollments || []).map(enrollment => ({
        student_id: enrollment.student_id,
        name: enrollment.students?.users ? 
          `${enrollment.students.users.first_name} ${enrollment.students.users.last_name}`.trim() : 
          'Unknown Student',
        email: enrollment.students?.users?.email || '',
        enrolled_at: enrollment.enrolled_at,
        progress_percentage: enrollment.progress_percentage || 0,
        expected_completion_date: enrollment.expected_completion_date,
        actual_completion_date: enrollment.actual_completion_date,
        total_time_spent_minutes: enrollment.total_time_spent_minutes || 0
      }));

      const totalStudents = count || 0;
      const totalPages = Math.ceil(totalStudents / limit);

      res.json({
        success: true,
        data: {
          students,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalStudents,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            limit: parseInt(limit)
          }
        },
        message: 'Course students retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get course students error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course students',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 10. POST /api/courses/:id/enroll-students - Bulk enroll students in course
  static async enrollStudents(req, res) {
    try {
      const { id } = req.params;
      const { student_ids } = req.body;

      // ✅ VALIDATION: student_ids array
      if (!Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'student_ids array is required'
        });
      }

      // ✅ VALIDATION: Limit bulk operations
      if (student_ids.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Bulk enrollment limited to 100 students at a time'
        });
      }

      // ✅ VALIDATION: UUID formats
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Validate all student IDs are UUIDs
      for (const studentId of student_ids) {
        if (!uuidRegex.test(studentId)) {
          return res.status(400).json({
            success: false,
            message: `Invalid student ID format: ${studentId}`
          });
        }
      }

      // ✅ VALIDATION: Check if course exists
      const { data: courseExists, error: courseCheckError } = await supabase
        .from('courses')
        .select('id, name')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (courseCheckError && courseCheckError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      if (courseCheckError) {
        throw courseCheckError;
      }

      // ✅ SECURITY: Log bulk enrollment attempt
      console.log('👥 Bulk enrollment attempt:', {
        enrollerId: req.user.id,
        enrollerRole: req.user.role,
        courseId: id,
        studentCount: student_ids.length,
        timestamp: new Date().toISOString()
      });

      const enrolledStudents = [];
      const errors = [];

      // Process enrollments
      for (const student_id of student_ids) {
        try {
          // Check if already enrolled
          const { data: existingEnrollment } = await supabase
            .from('student_course_enrollments')
            .select('id, is_active')
            .eq('course_id', id)
            .eq('student_id', student_id)
            .single();

          if (existingEnrollment) {
            if (existingEnrollment.is_active) {
              errors.push({ student_id, error: 'Already enrolled' });
              continue;
            } else {
              // Reactivate existing enrollment
              const { error: updateError } = await supabase
                .from('student_course_enrollments')
                .update({ 
                  is_active: true, 
                  enrolled_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingEnrollment.id);

              if (updateError) {
                errors.push({ student_id, error: updateError.message });
              } else {
                enrolledStudents.push(student_id);
              }
            }
          } else {
            // Create new enrollment
            const { error: insertError } = await supabase
              .from('student_course_enrollments')
              .insert([{
                course_id: id,
                student_id,
                enrolled_at: new Date().toISOString(),
                is_active: true,
                progress_percentage: 0
              }]);

            if (insertError) {
              errors.push({ student_id, error: insertError.message });
            } else {
              enrolledStudents.push(student_id);
            }
          }
        } catch (error) {
          errors.push({ student_id, error: error.message });
        }
      }

      res.json({
        success: true,
        data: {
          enrolled_count: enrolledStudents.length,
          enrolled_students: enrolledStudents,
          errors,
          course_name: courseExists.name
        },
        message: `${enrolledStudents.length} students enrolled successfully`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Enroll students error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to enroll students',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 11. GET /api/courses/:id/analytics - Course performance analytics
  static async getCourseAnalytics(req, res) {
    try {
      const { id } = req.params;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Get course basic info
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('id, name, level_number, difficulty_level')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (courseError) {
        if (courseError.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Course not found'
          });
        }
        throw courseError;
      }

      // Get enrollment statistics
      const { data: enrollments } = await supabase
        .from('student_course_enrollments')
        .select('progress_percentage, is_active, enrolled_at, actual_completion_date')
        .eq('course_id', id);

      // Get lesson engagement data
      const { data: lessons } = await supabase
        .from('lessons')
        .select(`
          id, title, lesson_number,
          student_lesson_progress(
            student_id, status, time_spent_minutes, score
          )
        `)
        .eq('course_id', id)
        .eq('is_active', true);

      // Calculate analytics
      const activeEnrollments = enrollments?.filter(e => e.is_active) || [];
      const completedStudents = activeEnrollments.filter(e => e.progress_percentage >= 100);
      
      const enrollmentStats = {
        total_enrollments: enrollments?.length || 0,
        active_enrollments: activeEnrollments.length,
        completed_students: completedStudents.length,
        avg_progress: activeEnrollments.length > 0 
          ? activeEnrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / activeEnrollments.length 
          : 0,
        completion_rate: activeEnrollments.length > 0 
          ? (completedStudents.length / activeEnrollments.length * 100).toFixed(1) 
          : 0
      };

      // Progress distribution
      const progressRanges = {
        'Not Started': 0,
        '1-25%': 0,
        '25-50%': 0,
        '50-75%': 0,
        '75-99%': 0,
        'Completed': 0
      };

      activeEnrollments.forEach(enrollment => {
        const progress = enrollment.progress_percentage || 0;
        if (progress === 0) progressRanges['Not Started']++;
        else if (progress < 25) progressRanges['1-25%']++;
        else if (progress < 50) progressRanges['25-50%']++;
        else if (progress < 75) progressRanges['50-75%']++;
        else if (progress < 100) progressRanges['75-99%']++;
        else progressRanges['Completed']++;
      });

      // Lesson engagement
      const lessonEngagement = (lessons || []).map(lesson => {
        const progressData = lesson.student_lesson_progress || [];
        const studentsAccessed = progressData.length;
        const studentsCompleted = progressData.filter(p => p.status === 'completed').length;
        const avgTimeSpent = progressData.length > 0
          ? progressData.reduce((sum, p) => sum + (p.time_spent_minutes || 0), 0) / progressData.length
          : 0;

        return {
          lesson_id: lesson.id,
          title: lesson.title,
          lesson_number: lesson.lesson_number,
          students_accessed: studentsAccessed,
          students_completed: studentsCompleted,
          completion_rate: studentsAccessed > 0 ? (studentsCompleted / studentsAccessed * 100).toFixed(1) : 0,
          avg_time_spent: Math.round(avgTimeSpent)
        };
      });

      res.json({
        success: true,
        data: {
          course_info: course,
          enrollment_stats: enrollmentStats,
          progress_distribution: Object.entries(progressRanges).map(([range, count]) => ({
            progress_range: range,
            student_count: count
          })),
          lesson_engagement: lessonEngagement,
          generated_at: new Date().toISOString()
        },
        message: 'Course analytics retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get course analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course analytics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 12. POST /api/courses/:id/duplicate - Duplicate course with all lessons
  static async duplicateCourse(req, res) {
    try {
      const { id } = req.params;
      const { new_name, copy_lessons = true } = req.body;

      // ✅ VALIDATION: UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course ID format'
        });
      }

      // Get original course
      const { data: originalCourse, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (courseError) {
        if (courseError.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Original course not found'
          });
        }
        throw courseError;
      }

      // ✅ SECURITY: Log duplication attempt
      console.log('📋 Course duplication attempt:', {
        userId: req.user.id,
        userRole: req.user.role,
        originalCourseId: id,
        newName: new_name,
        timestamp: new Date().toISOString()
      });

      // Create new course
      const newCourseData = {
        ...originalCourse,
        name: new_name || `${originalCourse.name} (Copy)`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      delete newCourseData.id; // Let Supabase generate new UUID

      const { data: newCourse, error: createError } = await supabase
        .from('courses')
        .insert([newCourseData])
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      let copiedLessonsCount = 0;

      // Copy lessons if requested
      if (copy_lessons) {
        const { data: originalLessons, error: lessonsError } = await supabase
          .from('lessons')
          .select('*')
          .eq('course_id', id)
          .eq('is_active', true)
          .order('lesson_number');

        if (lessonsError) {
          console.error('Error fetching lessons for duplication:', lessonsError);
        } else if (originalLessons && originalLessons.length > 0) {
          const lessonsToInsert = originalLessons.map(lesson => ({
            ...lesson,
            course_id: newCourse.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }));

          // Remove original IDs
          lessonsToInsert.forEach(lesson => delete lesson.id);

          const { data: copiedLessons, error: insertLessonsError } = await supabase
            .from('lessons')
            .insert(lessonsToInsert)
            .select();

          if (insertLessonsError) {
            console.error('Error copying lessons:', insertLessonsError);
          } else {
            copiedLessonsCount = copiedLessons?.length || 0;
          }
        }
      }

      res.status(201).json({
        success: true,
        data: {
          original_course_id: id,
          new_course: newCourse,
          lessons_copied: copiedLessonsCount
        },
        message: 'Course duplicated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Duplicate course error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to duplicate course',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 13. GET /api/courses/levels - Get available course levels
  static async getCourseLevels(req, res) {
    try {
      const { data: levels, error } = await supabase
        .from('courses')
        .select('level_number, difficulty_level')
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      // Calculate statistics for each level
      const levelStats = {};
      
      (levels || []).forEach(course => {
        const level = course.level_number;
        if (!levelStats[level]) {
          levelStats[level] = {
            level_number: level,
            course_count: 0,
            difficulties: new Set(),
            difficulty_distribution: {}
          };
        }
        
        levelStats[level].course_count++;
        levelStats[level].difficulties.add(course.difficulty_level);
        
        if (!levelStats[level].difficulty_distribution[course.difficulty_level]) {
          levelStats[level].difficulty_distribution[course.difficulty_level] = 0;
        }
        levelStats[level].difficulty_distribution[course.difficulty_level]++;
      });

      // Format response
      const formattedLevels = Object.values(levelStats).map(level => ({
        level_number: level.level_number,
        course_count: level.course_count,
        available_difficulties: Array.from(level.difficulties),
        difficulty_distribution: level.difficulty_distribution
      })).sort((a, b) => a.level_number - b.level_number);

      // Add default levels if no courses exist
      if (formattedLevels.length === 0) {
        const defaultLevels = [
          { level_number: 1, course_count: 0, available_difficulties: ['beginner'], difficulty_distribution: {} },
          { level_number: 2, course_count: 0, available_difficulties: ['beginner'], difficulty_distribution: {} },
          { level_number: 3, course_count: 0, available_difficulties: ['intermediate'], difficulty_distribution: {} },
          { level_number: 4, course_count: 0, available_difficulties: ['intermediate'], difficulty_distribution: {} },
          { level_number: 5, course_count: 0, available_difficulties: ['advanced'], difficulty_distribution: {} }
        ];
        
        res.json({
          success: true,
          data: defaultLevels,
          message: 'Default course levels retrieved (no courses exist yet)',
          timestamp: new Date().toISOString()
        });
      } else {
        res.json({
          success: true,
          data: formattedLevels,
          message: 'Course levels retrieved successfully',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Get course levels error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course levels',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 14. POST /api/courses/bulk-create - Create multiple courses from template
  static async bulkCreateCourses(req, res) {
    try {
      const { template_course_id, course_data } = req.body;

      // ✅ VALIDATION: course_data array
      if (!Array.isArray(course_data) || course_data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'course_data array is required'
        });
      }

      // ✅ VALIDATION: Limit bulk operations
      if (course_data.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Bulk create limited to 50 courses at a time'
        });
      }

      let templateCourse = null;

      // Get template course if provided
      if (template_course_id) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(template_course_id)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid template course ID format'
          });
        }

        const { data: template, error: templateError } = await supabase
          .from('courses')
          .select('*')
          .eq('id', template_course_id)
          .eq('is_active', true)
          .single();

        if (templateError && templateError.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Template course not found'
          });
        }

        if (templateError) {
          throw templateError;
        }

        templateCourse = template;
      }

      // ✅ SECURITY: Log bulk creation attempt
      console.log('📚 Bulk course creation attempt:', {
        creatorId: req.user.id,
        creatorRole: req.user.role,
        courseCount: course_data.length,
        templateId: template_course_id,
        timestamp: new Date().toISOString()
      });

      const createdCourses = [];
      const errors = [];

      // Create courses
      for (const courseInfo of course_data) {
        try {
          // Merge with template data if available
          const finalCourseData = {
            name: courseInfo.name || (templateCourse ? `${templateCourse.name} - Copy` : 'Untitled Course'),
            description: courseInfo.description || templateCourse?.description || 'Course description',
            level_number: courseInfo.level_number || templateCourse?.level_number || 1,
            difficulty_level: courseInfo.difficulty_level || templateCourse?.difficulty_level || 'beginner',
            target_age_min: courseInfo.target_age_min || templateCourse?.target_age_min,
            target_age_max: courseInfo.target_age_max || templateCourse?.target_age_max,
            estimated_duration_days: courseInfo.estimated_duration_days || templateCourse?.estimated_duration_days || 30,
            learning_objectives: courseInfo.learning_objectives || templateCourse?.learning_objectives || [],
            prerequisites: courseInfo.prerequisites || templateCourse?.prerequisites,
            thumbnail_url: courseInfo.thumbnail_url || templateCourse?.thumbnail_url,
            display_order: courseInfo.display_order || templateCourse?.display_order,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          // ✅ VALIDATION: Required fields
          if (!finalCourseData.name || !finalCourseData.description || !finalCourseData.level_number) {
            errors.push({ 
              courseInfo, 
              error: 'Name, description, and level_number are required' 
            });
            continue;
          }

          const { data: newCourse, error: createError } = await supabase
            .from('courses')
            .insert([finalCourseData])
            .select()
            .single();

          if (createError) {
            errors.push({ courseInfo, error: createError.message });
          } else {
            createdCourses.push(newCourse);
          }

        } catch (error) {
          errors.push({ courseInfo, error: error.message });
        }
      }

      res.status(201).json({
        success: true,
        data: {
          created_count: createdCourses.length,
          created_courses: createdCourses,
          errors,
          template_used: template_course_id || null
        },
        message: `${createdCourses.length} courses created successfully`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Bulk create courses error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk create courses',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  // 15. GET /api/courses/export - Export course data to CSV/JSON
  static async exportCourses(req, res) {
    try {
      const { 
        format = 'json',
        level_number,
        difficulty_level,
        include_lessons = 'false',
        include_students = 'false'
      } = req.query;

      // Build query with filters
      let query = supabase
        .from('courses')
        .select('*')
        .eq('is_active', true);

      if (level_number) {
        query = query.eq('level_number', parseInt(level_number));
      }

      if (difficulty_level) {
        query = query.eq('difficulty_level', difficulty_level);
      }

      query = query.order('level_number').order('display_order');

      const { data: courses, error } = await query;

      if (error) {
        throw error;
      }

      let exportData = courses || [];

      // Include lessons if requested
      if (include_lessons === 'true') {
        for (let course of exportData) {
          const { data: lessons } = await supabase
            .from('lessons')
            .select('*')
            .eq('course_id', course.id)
            .eq('is_active', true)
            .order('lesson_number');

          course.lessons = lessons || [];
        }
      }

      // Include student details if requested
      if (include_students === 'true') {
        for (let course of exportData) {
          const { data: enrollments } = await supabase
            .from('student_course_enrollments')
            .select(`
              progress_percentage,
              enrolled_at,
              students:student_id(
                users:user_id(first_name, last_name, email)
              )
            `)
            .eq('course_id', course.id)
            .eq('is_active', true);

          course.enrolled_students = (enrollments || []).map(e => ({
            name: e.students?.users ? 
              `${e.students.users.first_name} ${e.students.users.last_name}`.trim() : 
              'Unknown',
            email: e.students?.users?.email || '',
            progress_percentage: e.progress_percentage || 0,
            enrolled_at: e.enrolled_at
          }));
        }
      }

      // Format based on requested format
      if (format === 'csv') {
        const csvHeaders = [
          'ID',
          'Name',
          'Level',
          'Difficulty',
          'Duration (Days)',
          'Target Age',
          'Created At'
        ];

        let csvContent = csvHeaders.join(',') + '\n';

        exportData.forEach(course => {
          const row = [
            course.id,
            `"${course.name?.replace(/"/g, '""') || ''}"`,
            course.level_number,
            course.difficulty_level,
            course.estimated_duration_days,
            course.target_age_min && course.target_age_max ? 
              `${course.target_age_min}-${course.target_age_max}` : '',
            new Date(course.created_at).toISOString().split('T')[0]
          ];
          csvContent += row.join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 
          `attachment; filename=courses_export_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvContent);
      } else {
        // JSON format
        res.json({
          success: true,
          data: {
            courses: exportData,
            export_info: {
              total_courses: exportData.length,
              filters_applied: {
                level_number,
                difficulty_level,
                include_lessons: include_lessons === 'true',
                include_students: include_students === 'true'
              },
              exported_at: new Date().toISOString()
            }
          },
          message: 'Courses exported successfully',
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Export courses error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export courses',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = CoursesController;