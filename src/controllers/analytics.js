const { supabase } = require('../config/database');

// Utility function for error responses
const handleAnalyticsError = (error, res, operation) => {
  console.error(`Analytics ${operation} error:`, error);
  
  // Return proper error instead of fake data
  return res.status(500).json({
    success: false,
    message: `Failed to fetch ${operation}`,
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
};

// FIXED: No more dummy data fallbacks
const getDashboardStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get basic counts with parallel queries for better performance
    const [
      usersResult, 
      institutesResult, 
      videosResult
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('institutes').select('*', { count: 'exact', head: true }),
      supabase.from('video_content').select('*', { count: 'exact', head: true })
    ]);

    // Check for errors in basic queries
    if (usersResult.error) throw new Error(`Users query failed: ${usersResult.error.message}`);
    if (institutesResult.error) throw new Error(`Institutes query failed: ${institutesResult.error.message}`);
    if (videosResult.error) throw new Error(`Videos query failed: ${videosResult.error.message}`);

    // Get detailed user data for role distribution and growth calculation
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('role, status, created_at, last_login');

    if (usersError) throw new Error(`User details query failed: ${usersError.message}`);

    // Calculate user statistics
    const roleStats = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    const activeUsers = users.filter(u => u.status === 'active').length;

    // Calculate growth metrics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newUsersLast30Days = users.filter(u => 
      new Date(u.created_at) > thirtyDaysAgo
    ).length;

    const newUsersLast7Days = users.filter(u => 
      new Date(u.created_at) > sevenDaysAgo
    ).length;

    const activeUsersLast7Days = users.filter(u => 
      u.last_login && new Date(u.last_login) > sevenDaysAgo
    ).length;

    // Get video engagement data - handle gracefully if table doesn't exist
    let videoEngagement = {
      total_video_views: 0,
      completed_videos: 0,
      average_completion: 0,
      views_last_30_days: 0
    };

    try {
      const { data: progressData, error: progressError } = await supabase
        .from('student_progress')
        .select('watch_percentage, completed, video_id, created_at');

      if (!progressError && progressData) {
        videoEngagement = {
          total_video_views: progressData.length,
          completed_videos: progressData.filter(p => p.completed).length,
          average_completion: progressData.length > 0 
            ? (progressData.reduce((sum, p) => sum + (p.watch_percentage || 0), 0) / progressData.length).toFixed(2)
            : 0,
          views_last_30_days: progressData.filter(p => 
            new Date(p.created_at) > thirtyDaysAgo
          ).length
        };
      }
    } catch (progressError) {
      console.warn('Student progress data not available:', progressError.message);
      // Continue with default values
    }

    // Get video statistics
    const { data: videos, error: videosError } = await supabase
      .from('video_content')
      .select('view_count, status, category, created_at');

    if (videosError) throw new Error(`Video stats query failed: ${videosError.message}`);

    // FIXED: No hardcoded fallback values
    const videoStats = {
      total_views: videos.reduce((sum, v) => sum + (v.view_count || 0), 0),
      active_videos: videos.filter(v => v.status === 'active').length,
      new_videos_30_days: videos.filter(v => 
        new Date(v.created_at) > thirtyDaysAgo
      ).length
    };

    // Calculate growth percentages
    const userGrowthRate = usersResult.count > 0 
      ? ((newUsersLast30Days / Math.max(usersResult.count - newUsersLast30Days, 1)) * 100).toFixed(1)
      : "0";

    const engagementRate = usersResult.count > 0 
      ? ((activeUsersLast7Days / usersResult.count) * 100).toFixed(1)
      : "0";

    const videoGrowthRate = videosResult.count > 0
      ? Math.round((videoStats.new_videos_30_days / Math.max(videosResult.count - videoStats.new_videos_30_days, 1)) * 100)
      : 0;

    const viewsGrowthRate = videoEngagement.total_video_views > 0
      ? Math.round((videoEngagement.views_last_30_days / Math.max(videoEngagement.total_video_views - videoEngagement.views_last_30_days, 1)) * 100)
      : 0;

    // FIXED: Real data response - no fake fallbacks
    res.json({
      success: true,
      // Main stats for dashboard cards
      totalUsers: usersResult.count || 0,
      totalVideos: videosResult.count || 0,
      totalInstitutes: institutesResult.count || 0,
      monthlyViews: videoStats.total_views.toLocaleString(),
      
      // Growth metrics - real calculations
      usersChange: `+${userGrowthRate}%`,
      videosChange: `+${videoGrowthRate}%`,
      institutesChange: "+0%", // Would need historical data for real calculation
      viewsChange: `+${viewsGrowthRate}%`,
      
      // Detailed breakdown for analytics page
      dashboard: {
        overview: {
          total_users: usersResult.count || 0,
          total_institutes: institutesResult.count || 0,
          total_videos: videosResult.count || 0,
          active_users: activeUsers,
          new_users_30d: newUsersLast30Days,
          engagement_rate: `${engagementRate}%`
        },
        user_stats: {
          by_role: roleStats,
          active_percentage: usersResult.count > 0 
            ? ((activeUsers / usersResult.count) * 100).toFixed(1)
            : "0",
          new_last_7_days: newUsersLast7Days,
          active_last_7_days: activeUsersLast7Days
        },
        video_engagement: videoEngagement,
        video_stats: videoStats,
        growth: {
          new_users_this_month: newUsersLast30Days,
          user_growth_rate: `${userGrowthRate}%`,
          engagement_trend: activeUsersLast7Days > (activeUsers * 0.7) ? "increasing" : "stable"
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return handleAnalyticsError(error, res, 'dashboard statistics');
  }
};

const getUserEngagement = async (req, res) => {
  try {
    // Get user login frequency
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('last_login, created_at, role');

    if (usersError) throw new Error(`User engagement query failed: ${usersError.message}`);

    // Calculate engagement metrics
    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activeLastWeek = users.filter(u => 
      u.last_login && new Date(u.last_login) > lastWeek
    ).length;

    const activeLastMonth = users.filter(u => 
      u.last_login && new Date(u.last_login) > lastMonth
    ).length;

    res.json({
      success: true,
      engagement: {
        active_last_week: activeLastWeek,
        active_last_month: activeLastMonth,
        total_users: users.length,
        engagement_rate_week: users.length > 0 
          ? ((activeLastWeek / users.length) * 100).toFixed(1)
          : 0,
        engagement_rate_month: users.length > 0 
          ? ((activeLastMonth / users.length) * 100).toFixed(1)
          : 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return handleAnalyticsError(error, res, 'user engagement');
  }
};

const getVideoPerformance = async (req, res) => {
  try {
    // Get video performance data
    const { data: videoData, error: videoError } = await supabase
      .from('video_content')
      .select(`
        id, title, view_count, like_count, category, difficulty_level
      `);

    if (videoError) throw new Error(`Video performance query failed: ${videoError.message}`);

    // Try to get progress data, but don't fail if table doesn't exist
    let progressDataMap = {};
    try {
      const { data: progressData, error: progressError } = await supabase
        .from('student_progress')
        .select('video_id, watch_percentage, completed');

      if (!progressError && progressData) {
        // Group progress by video_id
        progressDataMap = progressData.reduce((acc, progress) => {
          if (!acc[progress.video_id]) acc[progress.video_id] = [];
          acc[progress.video_id].push(progress);
          return acc;
        }, {});
      }
    } catch (progressError) {
      console.warn('Student progress data not available:', progressError.message);
    }

    const videoPerformance = videoData.map(video => {
      const progressData = progressDataMap[video.id] || [];
      const completionRate = progressData.length > 0
        ? (progressData.filter(p => p.completed).length / progressData.length * 100).toFixed(1)
        : 0;

      const avgWatchTime = progressData.length > 0
        ? (progressData.reduce((sum, p) => sum + (p.watch_percentage || 0), 0) / progressData.length).toFixed(1)
        : 0;

      return {
        id: video.id,
        title: video.title,
        category: video.category,
        difficulty: video.difficulty_level,
        view_count: video.view_count || 0,
        like_count: video.like_count || 0,
        student_views: progressData.length,
        completion_rate: parseFloat(completionRate),
        avg_watch_percentage: parseFloat(avgWatchTime)
      };
    });

    // Sort by performance metrics
    videoPerformance.sort((a, b) => b.completion_rate - a.completion_rate);

    res.json({
      success: true,
      video_performance: videoPerformance,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return handleAnalyticsError(error, res, 'video performance');
  }
};

const getInstitutePerformance = async (req, res) => {
  try {
    const { institute_id } = req.query;

    // Get institute data with user counts
    let instituteQuery = supabase
      .from('institutes')
      .select(`
        *,
        users(id, role, status, last_login)
      `);

    if (institute_id) {
      instituteQuery = instituteQuery.eq('id', institute_id);
    }

    const { data: institutes, error: instituteError } = await instituteQuery;

    if (instituteError) throw new Error(`Institute performance query failed: ${instituteError.message}`);

    const institutePerformance = institutes.map(institute => {
      const users = institute.users || [];
      const students = users.filter(u => u.role === 'student');
      const teachers = users.filter(u => u.role === 'teacher' || u.role === 'institute_admin');
      const activeUsers = users.filter(u => u.status === 'active');

      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const activeLastWeek = users.filter(u => 
        u.last_login && new Date(u.last_login) > lastWeek
      );

      return {
        id: institute.id,
        name: institute.name,
        total_users: users.length,
        total_students: students.length,
        total_teachers: teachers.length,
        active_users: activeUsers.length,
        engagement_rate: users.length > 0 
          ? ((activeLastWeek.length / users.length) * 100).toFixed(1)
          : 0,
        location: institute.location,
        created_at: institute.created_at
      };
    });

    res.json({
      success: true,
      institute_performance: institutePerformance,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return handleAnalyticsError(error, res, 'institute performance');
  }
};

const exportAnalyticsData = async (req, res) => {
  try {
    const { 
      type = 'dashboard', 
      format = 'json',
      start_date,
      end_date 
    } = req.query;

    let data;

    switch (type) {
      case 'dashboard':
        // Get dashboard data for export
        const [usersResult, videosResult, institutesResult] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('video_content').select('*'),
          supabase.from('institutes').select('*')
        ]);

        // Check for errors
        if (usersResult.error) throw new Error(`Users export failed: ${usersResult.error.message}`);
        if (videosResult.error) throw new Error(`Videos export failed: ${videosResult.error.message}`);
        if (institutesResult.error) throw new Error(`Institutes export failed: ${institutesResult.error.message}`);

        data = {
          summary: {
            total_users: usersResult.data?.length || 0,
            total_videos: videosResult.data?.length || 0,
            total_institutes: institutesResult.data?.length || 0,
            generated_at: new Date().toISOString()
          },
          details: {
            users: usersResult.data || [],
            videos: videosResult.data || [],
            institutes: institutesResult.data || []
          }
        };
        break;
      
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type. Supported types: dashboard'
        });
    }

    if (format === 'csv') {
      // Simple CSV conversion for basic data
      const csv = 'Type,Count\nUsers,' + (data.summary.total_users || 0) + 
                 '\nVideos,' + (data.summary.total_videos || 0) + 
                 '\nInstitutes,' + (data.summary.total_institutes || 0);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${type}-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: data,
        exported_at: new Date().toISOString(),
        type: type
      });
    }

  } catch (error) {
    return handleAnalyticsError(error, res, 'data export');
  }
};

module.exports = {
  getDashboardStats,
  getUserEngagement,
  getVideoPerformance,
  getInstitutePerformance,
  exportAnalyticsData
};