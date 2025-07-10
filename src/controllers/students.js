const { supabase } = require('../config/database');

class StudentsController {

  // 1. GET /api/students - List all students (admin only)
  static async getAllStudents(req, res) {
    try {
      const { page = 1, limit = 20, search, class_level, institute_id } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('students')
        .select(`
          *,
          users:user_id(first_name, last_name, email),
          institutes:institute_id(name)
        `);

      // Apply filters
      if (search) {
        query = query.or(`student_id.ilike.%${search}%,class_level.ilike.%${search}%`);
      }
      if (class_level) query = query.eq('class_level', class_level);
      if (institute_id) query = query.eq('institute_id', institute_id);

      const { data: students, error, count } = await query
        .range(offset, offset + parseInt(limit) - 1)
        .order('created_at', { ascending: false });
      
      // Get total count separately
      const { count: totalCount } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      res.json({
        success: true,
        data: {
          students: students || [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil((totalCount || 0) / limit),
            totalStudents: totalCount || 0,
            hasNextPage: (totalCount || 0) > offset + limit,
            limit: parseInt(limit)
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get students error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch students'
      });
    }
  }

  // 2. GET /api/students/:id/progress - Student video progress summary
  static async getStudentProgress(req, res) {
    try {
      const { id } = req.params;
      
      // Check access permission
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Get video progress
      const { data: progress, error } = await supabase
        .from('student_progress')
        .select(`
          *,
          video_content:video_id(title, duration)
        `)
        .eq('student_id', id)
        .order('last_watched_at', { ascending: false });

      if (error) throw error;

      // Calculate summary stats
      const totalVideos = progress?.length || 0;
      const completedVideos = progress?.filter(p => p.completed).length || 0;
      const totalWatchTime = progress?.reduce((sum, p) => sum + (p.watch_time || 0), 0) || 0;
      const avgWatchPercentage = totalVideos > 0 
        ? progress.reduce((sum, p) => sum + (p.watch_percentage || 0), 0) / totalVideos 
        : 0;

      res.json({
        success: true,
        data: {
          summary: {
            total_videos: totalVideos,
            completed_videos: completedVideos,
            completion_rate: totalVideos > 0 ? (completedVideos / totalVideos * 100).toFixed(1) : 0,
            total_watch_time_minutes: totalWatchTime,
            average_watch_percentage: avgWatchPercentage.toFixed(1)
          },
          recent_progress: progress?.slice(0, 10) || []
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student progress error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student progress'
      });
    }
  }

  // 3. GET /api/students/:id/enrollments - Student course enrollments
  static async getStudentEnrollments(req, res) {
    try {
      const { id } = req.params;
      
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const { data: enrollments, error } = await supabase
        .from('student_course_enrollments')
        .select(`
          *,
          courses:course_id(id, name, level_number, difficulty_level)
        `)
        .eq('student_id', id)
        .eq('is_active', true)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        data: {
          enrollments: enrollments || [],
          total_enrolled: enrollments?.length || 0,
          active_courses: enrollments?.filter(e => e.progress_percentage < 100).length || 0,
          completed_courses: enrollments?.filter(e => e.progress_percentage >= 100).length || 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student enrollments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student enrollments'
      });
    }
  }

  // 4. GET /api/students/:id/points - Student points & rewards
  static async getStudentPoints(req, res) {
    try {
      const { id } = req.params;
      
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const { data: points, error } = await supabase
        .from('student_points')
        .select('*')
        .eq('student_id', id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      res.json({
        success: true,
        data: points || {
          total_points: 0,
          video_points: 0,
          exercise_points: 0,
          assessment_points: 0,
          streak_points: 0,
          current_streak_days: 0,
          longest_streak_days: 0,
          level_number: 1,
          level_progress_percentage: 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student points error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student points'
      });
    }
  }

  // 5. GET /api/students/:id/dashboard - Student dashboard data
  static async getStudentDashboard(req, res) {
    try {
      const { id } = req.params;
      
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Get all dashboard data in parallel
      const [
        { data: student },
        { data: points },
        { data: enrollments },
        { data: recentProgress },
        { data: achievements }
      ] = await Promise.all([
        supabase.from('students').select('*, users:user_id(first_name, last_name)').eq('id', id).single(),
        supabase.from('student_points').select('*').eq('student_id', id).single(),
        supabase.from('student_course_enrollments').select('*, courses:course_id(name)').eq('student_id', id).eq('is_active', true),
        supabase.from('student_progress').select('*, video_content:video_id(title)').eq('student_id', id).order('last_watched_at', { ascending: false }).limit(5),
        supabase.from('student_achievements').select('*, achievements:achievement_id(title, description)').eq('student_id', id).order('earned_at', { ascending: false }).limit(3)
      ]);

      const dashboard = {
        student_info: {
          id: student?.id,
          name: student?.users ? `${student.users.first_name} ${student.users.last_name}`.trim() : 'Unknown',
          student_id: student?.student_id,
          class_level: student?.class_level,
          learning_level: student?.learning_level
        },
        points_summary: points || { total_points: 0, current_streak_days: 0, level_number: 1 },
        course_summary: {
          total_enrolled: enrollments?.length || 0,
          active_courses: enrollments?.filter(e => e.progress_percentage < 100).length || 0,
          completed_courses: enrollments?.filter(e => e.progress_percentage >= 100).length || 0
        },
        recent_activity: recentProgress || [],
        recent_achievements: achievements || []
      };

      res.json({
        success: true,
        data: dashboard,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student dashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student dashboard'
      });
    }
  }

  // 6. POST /api/students/:id/enroll - Enroll student in course
  static async enrollStudent(req, res) {
    try {
      const { id } = req.params;
      const { course_id, expected_completion_date } = req.body;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: 'Course ID is required'
        });
      }

      // Check if already enrolled
      const { data: existing } = await supabase
        .from('student_course_enrollments')
        .select('id')
        .eq('student_id', id)
        .eq('course_id', course_id)
        .eq('is_active', true)
        .single();

      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Student already enrolled in this course'
        });
      }

      // Create enrollment
      const { data: enrollment, error } = await supabase
        .from('student_course_enrollments')
        .insert([{
          student_id: id,
          course_id,
          enrolled_by: req.user.id,
          expected_completion_date: expected_completion_date || null,
          enrolled_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: enrollment,
        message: 'Student enrolled successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Enroll student error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to enroll student'
      });
    }
  }

  // 7. PUT /api/students/:id/progress/:videoId - Update video progress
  static async updateVideoProgress(req, res) {
    try {
      const { id, videoId } = req.params;
      const { watch_percentage = 0, watch_time = 0, completed = false } = req.body;
      
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const progressData = {
        student_id: id,
        video_id: videoId,
        watch_percentage: Math.max(0, Math.min(100, watch_percentage)),
        watch_time: Math.max(0, watch_time),
        completed,
        last_watched_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (completed && !progressData.completed_at) {
        progressData.completed_at = new Date().toISOString();
      }

      const { data: progress, error } = await supabase
        .from('student_progress')
        .upsert(progressData)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: progress,
        message: 'Progress updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update video progress error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update progress'
      });
    }
  }

  // 8. GET /api/students/:id/achievements - Student achievements
  static async getStudentAchievements(req, res) {
    try {
      const { id } = req.params;
      
      const canAccess = await StudentsController.checkStudentAccess(id, req.user);
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      const { data: achievements, error } = await supabase
        .from('student_achievements')
        .select(`
          *,
          achievements:achievement_id(title, description, icon_url, category)
        `)
        .eq('student_id', id)
        .order('earned_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        data: {
          achievements: achievements || [],
          total_achievements: achievements?.length || 0,
          total_points_from_achievements: achievements?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get student achievements error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student achievements'
      });
    }
  }

  // Helper: Check if user can access student data
  static async checkStudentAccess(studentId, user) {
    // Admins can access all students
    if (['super_admin', 'zone_manager', 'institute_admin'].includes(user.role)) {
      return true;
    }

    // Students can only access their own data
    if (user.role === 'student') {
      const { data: student } = await supabase
        .from('students')
        .select('id')
        .eq('id', studentId)
        .eq('user_id', user.id)
        .single();
      return !!student;
    }

    // Parents can access their children (future implementation)
    if (user.role === 'parent') {
      // TODO: Implement parent-child relationship check
      return false;
    }

    return false;
  }
}

module.exports = StudentsController;