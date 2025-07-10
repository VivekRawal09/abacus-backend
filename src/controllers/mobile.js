const { supabase } = require('../config/database');
const jwt = require('jsonwebtoken');

// ✅ MOBILE CONTROLLER - Optimized for React Native
class MobileController {

  // 1. POST /api/mobile/auth/refresh - Refresh mobile app authentication token
  static async refreshToken(req, res) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      // Verify refresh token
      let decoded;
      try {
        decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      // Get user data to ensure they're still active
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, role, status')
        .eq('id', decoded.userId)
        .eq('status', 'active')
        .single();

      if (userError || !user) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive'
        });
      }

      // Generate new access token
      const newAccessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '24h',
          issuer: 'abacus-backend',
          audience: 'abacus-frontend'
        }
      );

      // Generate new refresh token
      const newRefreshToken = jwt.sign(
        {
          userId: user.id,
          type: 'refresh'
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '7d',
          issuer: 'abacus-backend',
          audience: 'abacus-frontend'
        }
      );

      // ✅ MOBILE OPTIMIZED: Minimal response
      res.json({
        success: true,
        data: {
          access_token: newAccessToken,
          refresh_token: newRefreshToken,
          expires_in: 86400, // 24 hours in seconds
          user_id: user.id,
          role: user.role
        },
        message: 'Token refreshed successfully'
      });

    } catch (error) {
      console.error('Mobile token refresh error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to refresh token'
      });
    }
  }

  // 2. GET /api/mobile/user/profile - Get mobile-optimized user profile
  static async getUserProfile(req, res) {
    try {
      const userId = req.user.id;

      // Get user with student/institute data
      const { data: user, error: userError } = await supabase
        .from('users')
        .select(`
          id,
          email,
          first_name,
          last_name,
          role,
          created_at,
          students!users_students_user_id_fkey(
            id,
            date_of_birth,
            grade_level,
            institute_id,
            institutes(name, code)
          )
        `)
        .eq('id', userId)
        .single();

      if (userError) {
        throw userError;
      }

      // Get student progress summary if user is a student
      let progressSummary = null;
      if (user.students && user.students.length > 0) {
        const studentId = user.students[0].id;
        
        const { data: enrollments } = await supabase
          .from('student_course_enrollments')
          .select(`
            course_id,
            progress_percentage,
            courses(name, level_number, difficulty_level)
          `)
          .eq('student_id', studentId)
          .eq('is_active', true);

        const { data: points } = await supabase
          .from('student_points')
          .select('total_points, current_streak_days, level_number')
          .eq('student_id', studentId)
          .single();

        progressSummary = {
          enrolled_courses: enrollments?.length || 0,
          total_points: points?.total_points || 0,
          current_streak: points?.current_streak_days || 0,
          level: points?.level_number || 1,
          current_courses: enrollments?.slice(0, 3) || [] // Latest 3 courses
        };
      }

      // ✅ MOBILE OPTIMIZED: Streamlined profile data
      const mobileProfile = {
        user_id: user.id,
        email: user.email,
        name: `${user.first_name} ${user.last_name}`.trim(),
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        member_since: new Date(user.created_at).toISOString().split('T')[0],
        student_info: user.students?.[0] ? {
          student_id: user.students[0].id,
          grade_level: user.students[0].grade_level,
          date_of_birth: user.students[0].date_of_birth,
          institute: {
            id: user.students[0].institute_id,
            name: user.students[0].institutes?.name,
            code: user.students[0].institutes?.code
          }
        } : null,
        progress: progressSummary
      };

      res.json({
        success: true,
        data: mobileProfile,
        message: 'Profile retrieved successfully'
      });

    } catch (error) {
      console.error('Get mobile profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profile'
      });
    }
  }

  // 3. PUT /api/mobile/user/profile - Update user profile from mobile
  static async updateUserProfile(req, res) {
    try {
      const userId = req.user.id;
      const { first_name, last_name, date_of_birth, grade_level } = req.body;

      // Update user basic info
      const userUpdates = {};
      if (first_name) userUpdates.first_name = first_name.trim();
      if (last_name) userUpdates.last_name = last_name.trim();

      if (Object.keys(userUpdates).length > 0) {
        userUpdates.updated_at = new Date().toISOString();
        
        const { error: userError } = await supabase
          .from('users')
          .update(userUpdates)
          .eq('id', userId);

        if (userError) throw userError;
      }

      // Update student info if provided
      if ((date_of_birth || grade_level) && req.user.role === 'student') {
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', userId)
          .single();

        if (student) {
          const studentUpdates = {};
          if (date_of_birth) studentUpdates.date_of_birth = date_of_birth;
          if (grade_level) studentUpdates.grade_level = grade_level;
          studentUpdates.updated_at = new Date().toISOString();

          const { error: studentError } = await supabase
            .from('students')
            .update(studentUpdates)
            .eq('id', student.id);

          if (studentError) throw studentError;
        }
      }

      // ✅ MOBILE OPTIMIZED: Simple confirmation response
      res.json({
        success: true,
        data: {
          updated_at: new Date().toISOString(),
          fields_updated: Object.keys(userUpdates)
        },
        message: 'Profile updated successfully'
      });

    } catch (error) {
      console.error('Update mobile profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }

  // 4. GET /api/mobile/user/preferences - Get mobile app user preferences
  static async getUserPreferences(req, res) {
    try {
      const userId = req.user.id;

      // Get user preferences or create default
      let { data: preferences, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Create default preferences
        const defaultPrefs = {
          user_id: userId,
          theme: 'light',
          language: 'en',
          notifications_enabled: true,
          email_notifications: true,
          push_notifications: true,
          sound_effects: true,
          auto_play_videos: false,
          video_quality: 'auto',
          abacus_settings: {
            bead_color: 'brown',
            frame_color: 'wood',
            animation_speed: 'normal',
            sound_enabled: true
          },
          exercise_settings: {
            difficulty: 'auto',
            time_limit: true,
            hints_enabled: true,
            auto_advance: false
          }
        };

        const { data: newPrefs, error: createError } = await supabase
          .from('user_preferences')
          .insert([defaultPrefs])
          .select()
          .single();

        if (createError) throw createError;
        preferences = newPrefs;
      } else if (error) {
        throw error;
      }

      // ✅ MOBILE OPTIMIZED: Organized preferences for React Native
      const mobilePreferences = {
        app_settings: {
          theme: preferences.theme || 'light',
          language: preferences.language || 'en',
          auto_play_videos: preferences.auto_play_videos || false,
          video_quality: preferences.video_quality || 'auto'
        },
        notifications: {
          push_enabled: preferences.push_notifications || true,
          email_enabled: preferences.email_notifications || true,
          sound_effects: preferences.sound_effects || true
        },
        abacus_settings: preferences.abacus_settings || {
          bead_color: 'brown',
          frame_color: 'wood',
          animation_speed: 'normal',
          sound_enabled: true
        },
        exercise_settings: preferences.exercise_settings || {
          difficulty: 'auto',
          time_limit: true,
          hints_enabled: true,
          auto_advance: false
        },
        last_updated: preferences.updated_at
      };

      res.json({
        success: true,
        data: mobilePreferences,
        message: 'Preferences retrieved successfully'
      });

    } catch (error) {
      console.error('Get mobile preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch preferences'
      });
    }
  }

  // 5. PUT /api/mobile/user/preferences - Update mobile app preferences
  static async updateUserPreferences(req, res) {
    try {
      const userId = req.user.id;
      const { app_settings, notifications, abacus_settings, exercise_settings } = req.body;

      // Build update object
      const updates = {
        updated_at: new Date().toISOString()
      };

      if (app_settings) {
        if (app_settings.theme) updates.theme = app_settings.theme;
        if (app_settings.language) updates.language = app_settings.language;
        if (app_settings.auto_play_videos !== undefined) updates.auto_play_videos = app_settings.auto_play_videos;
        if (app_settings.video_quality) updates.video_quality = app_settings.video_quality;
      }

      if (notifications) {
        if (notifications.push_enabled !== undefined) updates.push_notifications = notifications.push_enabled;
        if (notifications.email_enabled !== undefined) updates.email_notifications = notifications.email_enabled;
        if (notifications.sound_effects !== undefined) updates.sound_effects = notifications.sound_effects;
      }

      if (abacus_settings) {
        updates.abacus_settings = abacus_settings;
      }

      if (exercise_settings) {
        updates.exercise_settings = exercise_settings;
      }

      // Update preferences
      const { error } = await supabase
        .from('user_preferences')
        .update(updates)
        .eq('user_id', userId);

      if (error) throw error;

      // ✅ MOBILE OPTIMIZED: Simple confirmation
      res.json({
        success: true,
        data: {
          updated_at: updates.updated_at,
          settings_updated: Object.keys(updates).filter(key => key !== 'updated_at')
        },
        message: 'Preferences updated successfully'
      });

    } catch (error) {
      console.error('Update mobile preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update preferences'
      });
    }
  }

  // 6. GET /api/mobile/lessons/:id/details - Lesson details for mobile
  static async getLessonDetails(req, res) {
    try {
      const { id } = req.params;

      // Get lesson with content
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select(`
          id,
          course_id,
          title,
          description,
          lesson_number,
          lesson_type,
          estimated_duration_minutes,
          learning_objectives,
          is_mandatory,
          difficulty_level,
          lesson_content(
            content_type,
            content_id,
            content_order,
            points_awarded,
            is_mandatory
          ),
          courses(
            id,
            name,
            level_number,
            difficulty_level
          )
        `)
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (lessonError) {
        if (lessonError.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Lesson not found'
          });
        }
        throw lessonError;
      }

      // Get student progress for this lesson (if student)
      let progress = null;
      if (req.user.role === 'student') {
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', req.user.id)
          .single();

        if (student) {
          const { data: lessonProgress } = await supabase
            .from('student_lesson_progress')
            .select('status, score, time_spent_minutes, completed_at')
            .eq('student_id', student.id)
            .eq('lesson_id', id)
            .single();

          progress = lessonProgress;
        }
      }

      // ✅ MOBILE OPTIMIZED: Structured for React Native
      const mobileLesson = {
        lesson_id: lesson.id,
        course_id: lesson.course_id,
        title: lesson.title,
        description: lesson.description,
        lesson_number: lesson.lesson_number,
        type: lesson.lesson_type,
        duration_minutes: lesson.estimated_duration_minutes,
        difficulty: lesson.difficulty_level,
        is_mandatory: lesson.is_mandatory,
        objectives: lesson.learning_objectives || [],
        course_info: {
          id: lesson.courses.id,
          name: lesson.courses.name,
          level: lesson.courses.level_number,
          difficulty: lesson.courses.difficulty_level
        },
        content: (lesson.lesson_content || []).map(content => ({
          type: content.content_type,
          content_id: content.content_id,
          order: content.content_order,
          points: content.points_awarded,
          mandatory: content.is_mandatory
        })),
        progress: progress ? {
          status: progress.status,
          score: progress.score,
          time_spent: progress.time_spent_minutes,
          completed_at: progress.completed_at
        } : {
          status: 'not_started',
          score: 0,
          time_spent: 0,
          completed_at: null
        }
      };

      res.json({
        success: true,
        data: mobileLesson,
        message: 'Lesson details retrieved successfully'
      });

    } catch (error) {
      console.error('Get mobile lesson details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lesson details'
      });
    }
  }

  // 7. POST /api/mobile/lessons/:id/start - Start lesson on mobile
  static async startLesson(req, res) {
    try {
      const { id } = req.params;

      // Verify lesson exists
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('id, course_id, title')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (lessonError) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Get student ID
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (studentError) {
        return res.status(403).json({
          success: false,
          message: 'Student access required'
        });
      }

      // Create or update lesson progress
      const { data: existingProgress } = await supabase
        .from('student_lesson_progress')
        .select('id, status')
        .eq('student_id', student.id)
        .eq('lesson_id', id)
        .single();

      if (existingProgress) {
        // Update existing progress to in_progress
        if (existingProgress.status !== 'completed') {
          await supabase
            .from('student_lesson_progress')
            .update({
              status: 'in_progress',
              updated_at: new Date().toISOString()
            })
            .eq('id', existingProgress.id);
        }
      } else {
        // Create new progress record
        await supabase
          .from('student_lesson_progress')
          .insert([{
            student_id: student.id,
            lesson_id: id,
            course_id: lesson.course_id,
            status: 'in_progress',
            started_at: new Date().toISOString()
          }]);
      }

      // Log activity
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'lesson_started',
          entity_type: 'lesson',
          entity_id: id,
          details: {
            lesson_title: lesson.title,
            course_id: lesson.course_id,
            platform: 'mobile'
          }
        }]);

      // ✅ MOBILE OPTIMIZED: Simple start confirmation
      res.json({
        success: true,
        data: {
          lesson_id: id,
          status: 'started',
          started_at: new Date().toISOString()
        },
        message: 'Lesson started successfully'
      });

    } catch (error) {
      console.error('Start mobile lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start lesson'
      });
    }
  }

  // 8. PUT /api/mobile/lessons/:id/complete - Complete lesson on mobile
  static async completeLesson(req, res) {
    try {
      const { id } = req.params;
      const { score = 0, time_spent_minutes = 0 } = req.body;

      // Get student ID
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (studentError) {
        return res.status(403).json({
          success: false,
          message: 'Student access required'
        });
      }

      // Get lesson info
      const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('id, course_id, title, lesson_content(points_awarded)')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (lessonError) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found'
        });
      }

      // Calculate total possible points
      const totalPoints = lesson.lesson_content?.reduce((sum, content) => 
        sum + (content.points_awarded || 0), 0) || 0;

      // Update lesson progress
      const { error: progressError } = await supabase
        .from('student_lesson_progress')
        .upsert({
          student_id: student.id,
          lesson_id: id,
          course_id: lesson.course_id,
          status: 'completed',
          score: Math.min(score, totalPoints),
          time_spent_minutes,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (progressError) throw progressError;

      // Update student points
      await supabase
        .from('student_points')
        .upsert({
          student_id: student.id,
          total_points: supabase.raw('total_points + ?', [score]),
          video_points: supabase.raw('video_points + ?', [score]),
          last_activity_date: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        });

      // Log completion activity
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'lesson_completed',
          entity_type: 'lesson',
          entity_id: id,
          details: {
            lesson_title: lesson.title,
            score,
            time_spent_minutes,
            platform: 'mobile'
          }
        }]);

      // ✅ MOBILE OPTIMIZED: Completion data with achievements check
      res.json({
        success: true,
        data: {
          lesson_id: id,
          status: 'completed',
          score,
          time_spent_minutes,
          points_earned: score,
          completed_at: new Date().toISOString(),
          achievements_unlocked: [] // TODO: Check for new achievements
        },
        message: 'Lesson completed successfully'
      });

    } catch (error) {
      console.error('Complete mobile lesson error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete lesson'
      });
    }
  }

  // 9. GET /api/mobile/videos/:id/stream - Video streaming optimized for mobile
  static async getVideoStream(req, res) {
    try {
      const { id } = req.params;
      const { quality = 'auto' } = req.query;

      // Get video details
      const { data: video, error: videoError } = await supabase
        .from('video_content')
        .select('id, title, youtube_url, duration, thumbnail_url, view_count')
        .eq('id', id)
        .eq('status', 'active')
        .single();

      if (videoError) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Update view count
      await supabase
        .from('video_content')
        .update({ view_count: (video.view_count || 0) + 1 })
        .eq('id', id);

      // Log video access
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'video_accessed',
          entity_type: 'video',
          entity_id: id,
          details: {
            video_title: video.title,
            quality_requested: quality,
            platform: 'mobile'
          }
        }]);

      // ✅ MOBILE OPTIMIZED: Video streaming data
      const mobileVideo = {
        video_id: video.id,
        title: video.title,
        stream_url: video.youtube_url,
        duration: video.duration,
        thumbnail: video.thumbnail_url,
        quality_options: ['360p', '480p', '720p', 'auto'],
        recommended_quality: quality,
        offline_available: false, // TODO: Implement offline download
        subtitles_available: false // TODO: Add subtitle support
      };

      res.json({
        success: true,
        data: mobileVideo,
        message: 'Video stream ready'
      });

    } catch (error) {
      console.error('Get mobile video stream error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load video'
      });
    }
  }

  // 10. POST /api/mobile/videos/:id/bookmark - Bookmark video in mobile app
  static async bookmarkVideo(req, res) {
    try {
      const { id } = req.params;
      const { timestamp = 0, note = '' } = req.body;

      // Verify video exists
      const { data: video, error: videoError } = await supabase
        .from('video_content')
        .select('id, title')
        .eq('id', id)
        .single();

      if (videoError) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Create bookmark
      const { data: bookmark, error: bookmarkError } = await supabase
        .from('video_bookmarks')
        .insert([{
          user_id: req.user.id,
          video_id: id,
          timestamp,
          note: note.trim(),
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (bookmarkError) throw bookmarkError;

      // ✅ MOBILE OPTIMIZED: Simple bookmark confirmation
      res.json({
        success: true,
        data: {
          bookmark_id: bookmark.id,
          video_id: id,
          timestamp,
          note,
          created_at: bookmark.created_at
        },
        message: 'Video bookmarked successfully'
      });

    } catch (error) {
      console.error('Bookmark video error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bookmark video'
      });
    }
  }

  // 11. GET /api/mobile/videos/:id/bookmarks - Get video bookmarks
  static async getVideoBookmarks(req, res) {
    try {
      const { id } = req.params;

      // Get bookmarks for this video
      const { data: bookmarks, error } = await supabase
        .from('video_bookmarks')
        .select('id, timestamp, note, created_at')
        .eq('user_id', req.user.id)
        .eq('video_id', id)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      // ✅ MOBILE OPTIMIZED: Bookmark list for video player
      const mobileBookmarks = (bookmarks || []).map(bookmark => ({
        id: bookmark.id,
        timestamp: bookmark.timestamp,
        note: bookmark.note,
        formatted_time: formatDuration(bookmark.timestamp),
        created_at: bookmark.created_at
      }));

      res.json({
        success: true,
        data: {
          video_id: id,
          bookmarks: mobileBookmarks,
          total_bookmarks: mobileBookmarks.length
        },
        message: 'Bookmarks retrieved successfully'
      });

    } catch (error) {
      console.error('Get video bookmarks error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bookmarks'
      });
    }
  }

  // 12. GET /api/mobile/exercises/history/:student_id - Exercise history for mobile
  static async getExerciseHistory(req, res) {
    try {
      const { student_id } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      // Verify student access
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('id, user_id')
        .eq('id', student_id)
        .single();

      if (studentError || student.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      // Get exercise history
      const { data: sessions, error } = await supabase
        .from('exercise_sessions')
        .select(`
          id,
          category_id,
          session_type,
          total_problems,
          correct_answers,
          accuracy_percentage,
          score,
          completed,
          created_at,
          exercise_categories(name, difficulty_level)
        `)
        .eq('student_id', student_id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // ✅ MOBILE OPTIMIZED: Exercise history for stats screen
      const mobileHistory = (sessions || []).map(session => ({
        session_id: session.id,
        category: session.exercise_categories?.name || 'Unknown',
        difficulty: session.exercise_categories?.difficulty_level || 'beginner',
        type: session.session_type,
        problems_solved: session.total_problems,
        correct_answers: session.correct_answers,
        accuracy: Math.round(session.accuracy_percentage || 0),
        score: session.score,
        completed: session.completed,
        date: new Date(session.created_at).toISOString().split('T')[0],
        time: new Date(session.created_at).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      }));

      res.json({
        success: true,
        data: {
          student_id,
          history: mobileHistory,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            has_more: mobileHistory.length === parseInt(limit)
          }
        },
        message: 'Exercise history retrieved successfully'
      });

    } catch (error) {
      console.error('Get exercise history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise history'
      });
    }
  }

  // 13. POST /api/mobile/activity-log - Log detailed mobile app activity
  static async logActivity(req, res) {
    try {
      const { 
        action, 
        entity_type, 
        entity_id, 
        details = {},
        timestamp = new Date().toISOString()
      } = req.body;

      // Validation
      if (!action || !entity_type) {
        return res.status(400).json({
          success: false,
          message: 'Action and entity_type are required'
        });
      }

      // Enhanced details for mobile analytics
      const mobileDetails = {
        ...details,
        platform: 'mobile',
        app_version: req.headers['x-app-version'] || 'unknown',
        device_info: {
          os: req.headers['x-device-os'] || 'unknown',
          model: req.headers['x-device-model'] || 'unknown',
          app_build: req.headers['x-app-build'] || 'unknown'
        },
        session_info: {
          user_agent: req.headers['user-agent'],
          ip_address: req.ip,
          timestamp: timestamp
        }
      };

      // Log activity
      const { data: activityLog, error } = await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action,
          entity_type,
          entity_id,
          details: mobileDetails,
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
          platform: 'mobile',
          created_at: timestamp
        }])
        .select()
        .single();

      if (error) throw error;

      // ✅ MOBILE OPTIMIZED: Simple activity log confirmation
      res.json({
        success: true,
        data: {
          log_id: activityLog.id,
          action,
          logged_at: activityLog.created_at
        },
        message: 'Activity logged successfully'
      });

    } catch (error) {
      console.error('Log mobile activity error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to log activity'
      });
    }
  }

  // 14. GET /api/mobile/support/faq - FAQ content for mobile app
  static async getSupportFAQ(req, res) {
    try {
      const { category = 'general', language = 'en' } = req.query;

      // Static FAQ data (could be moved to database)
      const faqData = {
        general: [
          {
            id: 1,
            question: "How do I start learning with ABACUS?",
            answer: "Begin with Level 1: ABACUS Introduction. This course covers the basics of ABACUS structure and number recognition. Complete each lesson in order to build your foundation.",
            category: "getting_started",
            helpful_count: 45,
            tags: ["beginner", "starting", "level1"]
          },
          {
            id: 2,
            question: "Can I download lessons for offline use?",
            answer: "Currently, lessons require an internet connection to access videos and interactive content. We're working on offline capabilities for future updates.",
            category: "technical",
            helpful_count: 32,
            tags: ["offline", "download", "internet"]
          },
          {
            id: 3,
            question: "How is my progress tracked?",
            answer: "Your progress is automatically saved as you complete lessons and exercises. You can view detailed analytics in your profile, including accuracy, time spent, and achievements earned.",
            category: "progress",
            helpful_count: 28,
            tags: ["progress", "tracking", "analytics"]
          },
          {
            id: 4,
            question: "What are the different course levels?",
            answer: "We offer 5 main levels: Level 1 (Introduction), Level 2 (Addition), Level 3 (Subtraction), Level 4 (Multiplication), and Level 5 (Advanced Operations). Each level builds on previous skills.",
            category: "courses",
            helpful_count: 41,
            tags: ["levels", "courses", "curriculum"]
          },
          {
            id: 5,
            question: "How do I change my ABACUS settings?",
            answer: "Go to Settings > Preferences to customize your ABACUS appearance, including bead colors, frame style, and animation speed. Find what works best for your learning style.",
            category: "settings",
            helpful_count: 19,
            tags: ["settings", "customization", "abacus"]
          }
        ],
        technical: [
          {
            id: 6,
            question: "The app is running slowly. What can I do?",
            answer: "Try closing other apps, restarting the ABACUS app, or lowering video quality in Settings. Ensure you have a stable internet connection for best performance.",
            category: "performance",
            helpful_count: 15,
            tags: ["performance", "slow", "optimization"]
          },
          {
            id: 7,
            question: "Videos won't play. How do I fix this?",
            answer: "Check your internet connection and try refreshing the lesson. If problems persist, try lowering video quality in Settings or contact support.",
            category: "video_issues",
            helpful_count: 23,
            tags: ["video", "streaming", "playback"]
          }
        ],
        account: [
          {
            id: 8,
            question: "How do I reset my password?",
            answer: "Use the 'Forgot Password' link on the login screen. Enter your email address and follow the instructions sent to your email to reset your password.",
            category: "authentication",
            helpful_count: 18,
            tags: ["password", "reset", "login"]
          },
          {
            id: 9,
            question: "Can I change my email address?",
            answer: "Currently, email addresses cannot be changed directly in the app. Please contact support to update your email address.",
            category: "profile",
            helpful_count: 12,
            tags: ["email", "profile", "account"]
          }
        ]
      };

      // Get FAQ for requested category
      const faqs = faqData[category] || faqData.general;

      // ✅ MOBILE OPTIMIZED: FAQ data for mobile help screen
      const mobileFAQs = faqs.map(faq => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        helpful_count: faq.helpful_count,
        tags: faq.tags
      }));

      res.json({
        success: true,
        data: {
          category,
          faqs: mobileFAQs,
          available_categories: Object.keys(faqData),
          total_faqs: mobileFAQs.length
        },
        message: 'FAQ retrieved successfully'
      });

    } catch (error) {
      console.error('Get support FAQ error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch FAQ'
      });
    }
  }

  // 15. POST /api/mobile/support/ticket - Create support ticket from mobile
  static async createSupportTicket(req, res) {
    try {
      const {
        subject,
        description,
        category = 'general',
        priority = 'medium',
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
          message: 'Subject must be at least 5 characters and description at least 10 characters'
        });
      }

      // Enhanced device info for mobile support
      const enhancedDeviceInfo = {
        ...device_info,
        app_version: req.headers['x-app-version'] || 'unknown',
        os: req.headers['x-device-os'] || 'unknown',
        model: req.headers['x-device-model'] || 'unknown',
        user_agent: req.headers['user-agent'],
        platform: 'mobile',
        timestamp: new Date().toISOString()
      };

      // Create support ticket
      const { data: ticket, error } = await supabase
        .from('support_tickets')
        .insert([{
          user_id: req.user.id,
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          status: 'open',
          device_info: enhancedDeviceInfo,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      // Log support ticket creation
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'support_ticket_created',
          entity_type: 'support_ticket',
          entity_id: ticket.id,
          details: {
            subject: subject.trim(),
            category,
            priority,
            platform: 'mobile'
          }
        }]);

      // ✅ MOBILE OPTIMIZED: Support ticket confirmation
      res.status(201).json({
        success: true,
        data: {
          ticket_id: ticket.id,
          ticket_number: `ABACUS-${ticket.id.slice(0, 8).toUpperCase()}`,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          created_at: ticket.created_at,
          estimated_response_time: '24-48 hours'
        },
        message: 'Support ticket created successfully'
      });

    } catch (error) {
      console.error('Create support ticket error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create support ticket'
      });
    }
  }
}

// ✅ UTILITY FUNCTIONS

// Format duration in seconds to MM:SS format
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

module.exports = MobileController;