const { supabase } = require('../config/database');

const getDashboardStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get basic counts
    const [usersResult, institutesResult, videosResult, studentsResult] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('institutes').select('*', { count: 'exact', head: true }),
      supabase.from('video_content').select('*', { count: 'exact', head: true }),
      supabase.from('students').select('*', { count: 'exact', head: true })
    ]);

    // Get user role distribution
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('role, status, created_at');

    if (usersError) throw usersError;

    const roleStats = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    const activeUsers = users.filter(u => u.status === 'active').length;

    // Get video engagement stats
    const { data: progressData, error: progressError } = await supabase
      .from('student_progress')
      .select('watch_percentage, completed, video_id');

    if (progressError) throw progressError;

    const videoEngagement = {
      total_video_views: progressData.length,
      completed_videos: progressData.filter(p => p.completed).length,
      average_completion: progressData.length > 0 
        ? (progressData.reduce((sum, p) => sum + (p.watch_percentage || 0), 0) / progressData.length).toFixed(2)
        : 0
    };

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentUsers = users.filter(u => 
      new Date(u.created_at) > thirtyDaysAgo
    ).length;

    res.json({
      success: true,
      dashboard: {
        overview: {
          total_users: usersResult.count || 0,
          total_institutes: institutesResult.count || 0,
          total_videos: videosResult.count || 0,
          total_students: studentsResult.count || 0,
          active_users: activeUsers,
          new_users_30d: recentUsers
        },
        user_stats: {
          by_role: roleStats,
          active_percentage: usersResult.count > 0 
            ? ((activeUsers / usersResult.count) * 100).toFixed(1)
            : 0
        },
        video_engagement: videoEngagement,
        growth: {
          new_users_this_month: recentUsers,
          user_growth_rate: "12.5%" // Placeholder - would calculate from historical data
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getUserEngagement = async (req, res) => {
  try {
    // Get user login frequency
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('last_login, created_at, role');

    if (usersError) throw usersError;

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
      }
    });

  } catch (error) {
    console.error('Get user engagement error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getVideoPerformance = async (req, res) => {
  try {
    // Get video performance data
    const { data: videoData, error: videoError } = await supabase
      .from('video_content')
      .select(`
        id, title, view_count, like_count, category, difficulty_level,
        student_progress(watch_percentage, completed)
      `);

    if (videoError) throw videoError;

    const videoPerformance = videoData.map(video => {
      const progressData = video.student_progress || [];
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
      video_performance: videoPerformance
    });

  } catch (error) {
    console.error('Get video performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getDashboardStats,
  getUserEngagement,
  getVideoPerformance
};