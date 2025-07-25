// src/controllers/analytics-advanced.js
const { supabase } = require('../config/database');

class AdvancedAnalyticsController {

  // 1. GET /api/analytics-advanced/students/:id - Individual student analytics
  static async getStudentAnalytics(req, res) {
    try {
      const { id } = req.params;
      const { days = 30 } = req.query;

      // Check student access (students can only see their own data)
      let studentQuery = supabase
        .from('students')
        .select('*, users:user_id(first_name, last_name)')
        .eq('id', id);

      if (req.user.role === 'student') {
        studentQuery = studentQuery.eq('user_id', req.user.id);
      }

      const { data: student, error: studentError } = await studentQuery.single();

      if (studentError || !student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found or access denied'
        });
      }

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));

      // Get basic student data for analytics
      const [
        { data: points },
        { data: achievements }
      ] = await Promise.all([
        // Points summary
        supabase.from('student_points')
          .select('*')
          .eq('student_id', id)
          .single(),
        
        // Recent achievements
        supabase.from('student_achievements')
          .select('*, achievements:achievement_id(name, points_awarded, rarity)')
          .eq('student_id', id)
          .order('earned_at', { ascending: false })
          .limit(10)
      ]);

      res.json({
        success: true,
        data: {
          student_overview: {
            name: student.users ? `${student.users.first_name} ${student.users.last_name}`.trim() : 'Unknown',
            class_level: student.class_level,
            learning_level: student.learning_level,
            total_points: points?.total_points || 0,
            current_streak: points?.current_streak_days || 0,
            level: points?.level_number || 1
          },
          recent_achievements: achievements?.map(a => ({
            name: a.achievements?.name,
            points: a.achievements?.points_awarded,
            rarity: a.achievements?.rarity,
            earned_at: a.earned_at
          })) || []
        },
        period: `Last ${days} days`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get student analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch student analytics'
      });
    }
  }

  // 2. GET /api/analytics-advanced/courses/:id - Individual course analytics
  static async getCourseAnalytics(req, res) {
    try {
      const { id } = req.params;

      // Get course details
      const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('id', id)
        .single();

      if (courseError || !course) {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }

      // Get course enrollments
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('student_course_enrollments')
        .select('*')
        .eq('course_id', id);

      if (enrollmentError) throw enrollmentError;

      // Calculate metrics
      const totalEnrolled = enrollments?.length || 0;
      const completedStudents = enrollments?.filter(e => e.progress_percentage >= 100).length || 0;
      const avgProgress = totalEnrolled > 0
        ? (enrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / totalEnrolled).toFixed(1)
        : 0;

      res.json({
        success: true,
        data: {
          course_overview: {
            id: course.id,
            name: course.name,
            level_number: course.level_number,
            difficulty_level: course.difficulty_level,
            is_active: course.is_active
          },
          enrollment_metrics: {
            total_enrolled: totalEnrolled,
            completed_students: completedStudents,
            completion_rate: totalEnrolled > 0 ? ((completedStudents / totalEnrolled) * 100).toFixed(1) + '%' : '0%',
            average_progress: avgProgress + '%'
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get course analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course analytics'
      });
    }
  }

  // 3. GET /api/analytics-advanced/exercises - Exercise performance analytics
  static async getExerciseAnalytics(req, res) {
    try {
      const { days = 30 } = req.query;

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));

      // Get exercise attempts (simplified for testing)
      const { data: attempts, error } = await supabase
        .from('exercise_attempts')
        .select('*')
        .gte('created_at', dateThreshold.toISOString());

      if (error) throw error;

      const totalAttempts = attempts?.length || 0;
      const avgScore = totalAttempts > 0
        ? (attempts.reduce((sum, a) => sum + (a.score || 0), 0) / totalAttempts).toFixed(1)
        : 0;

      res.json({
        success: true,
        data: {
          overview: {
            total_attempts: totalAttempts,
            average_score: avgScore + '%',
            period: `Last ${days} days`
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get exercise analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise analytics'
      });
    }
  }

  // 4. GET /api/analytics-advanced/engagement - Engagement trend analysis
  static async getEngagementTrends(req, res) {
    try {
      const { days = 30 } = req.query;

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));

      // Get activity logs for engagement analysis
      const { data: activities, error } = await supabase
        .from('activity_logs')
        .select('action, created_at, platform')
        .gte('created_at', dateThreshold.toISOString())
        .limit(1000);

      if (error) throw error;

      const totalSessions = activities?.length || 0;
      const uniqueDays = new Set(activities?.map(a => a.created_at.split('T')[0])).size;

      res.json({
        success: true,
        data: {
          overview: {
            total_sessions: totalSessions,
            unique_active_days: uniqueDays,
            period: `Last ${days} days`
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get engagement trends error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch engagement trends'
      });
    }
  }

  // 5. GET /api/analytics-advanced/completion - Course/lesson completion rates
  static async getCompletionRates(req, res) {
    try {
      // Get course enrollments
      const { data: enrollments, error } = await supabase
        .from('student_course_enrollments')
        .select('*, courses:course_id(name, level_number)');

      if (error) throw error;

      const totalEnrollments = enrollments?.length || 0;
      const completedEnrollments = enrollments?.filter(e => e.progress_percentage >= 100).length || 0;

      res.json({
        success: true,
        data: {
          overview: {
            total_enrollments: totalEnrollments,
            overall_completion_rate: totalEnrollments > 0 
              ? ((completedEnrollments / totalEnrollments) * 100).toFixed(1) + '%'
              : '0%'
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get completion rates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch completion rates'
      });
    }
  }

  // 6. GET /api/analytics-advanced/revenue - Revenue analytics
  static async getRevenueAnalytics(req, res) {
    try {
      // Get payment transactions
      const { data: transactions, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('payment_status', 'completed');

      if (error) throw error;

      const totalRevenue = transactions?.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0) || 0;
      const totalTransactions = transactions?.length || 0;

      res.json({
        success: true,
        data: {
          overview: {
            total_revenue: totalRevenue.toFixed(2),
            total_transactions: totalTransactions
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get revenue analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch revenue analytics'
      });
    }
  }
}

module.exports = AdvancedAnalyticsController;