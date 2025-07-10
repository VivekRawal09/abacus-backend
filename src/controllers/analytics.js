const { supabase } = require('../config/database');

// Import utilities
const {
  formatSuccessResponse,
  formatErrorResponse,
  asyncHandler
} = require('../utils/responseUtils');

const { statsCache } = require('../utils/cacheUtils');

// Utility function for error responses
const handleAnalyticsError = (error, res, operation) => {
  console.error(`Analytics ${operation} error:`, error);
  
  return res.status(500).json({
    success: false,
    message: `Failed to fetch ${operation}`,
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
};

/**
 * ✅ SECURITY FIX: Apply role-based filtering to analytics queries
 */
const applyScopeFiltersToQuery = (query, user, entityType = 'users') => {
  // Super admin sees everything
  if (user.permissions.isSuperAdmin) {
    return query;
  }
  
  // Zone manager sees data from their zone
  if (user.permissions.isZoneManager && user.zone_id) {
    if (entityType === 'users' || entityType === 'institutes') {
      query = query.eq('zone_id', user.zone_id);
    } else if (entityType === 'video_content') {
      // For videos, filter by institute assignments (will need video_assignments table)
      // For now, zone managers see all videos (this can be refined later)
      return query;
    }
  }
  
  // Institute admin sees data from their institute
  else if (user.permissions.isInstituteAdmin && user.institute_id) {
    if (entityType === 'users') {
      query = query.eq('institute_id', user.institute_id);
    } else if (entityType === 'institutes') {
      query = query.eq('id', user.institute_id);
    } else if (entityType === 'video_content') {
      // For videos, filter by institute assignments (will need video_assignments table)
      // For now, institute admins see all videos (this can be refined later)
      return query;
    }
  }
  
  // Other roles get no data
  else {
    query = query.eq('id', -1); // Non-existent ID to return empty results
  }
  
  return query;
};

/**
 * ✅ SECURITY FIX: Get institute IDs that user can access
 */
const getAccessibleInstituteIds = async (user) => {
  if (user.permissions.isSuperAdmin) {
    const { data, error } = await supabase
      .from('institutes')
      .select('id');
    
    if (error) throw error;
    return data.map(inst => inst.id);
  }
  
  if (user.permissions.isZoneManager && user.zone_id) {
    const { data, error } = await supabase
      .from('institutes')
      .select('id')
      .eq('zone_id', user.zone_id);
    
    if (error) throw error;
    return data.map(inst => inst.id);
  }
  
  if (user.permissions.isInstituteAdmin && user.institute_id) {
    return [user.institute_id];
  }
  
  return []; // No accessible institutes
};

// ✅ ENHANCED: getDashboardStats with comprehensive role-based scoping
const getDashboardStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  // ✅ NEW: Create cache key that includes user scope
  const cacheKey = statsCache.createKey('analytics:dashboard', {
    startDate, endDate,
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await statsCache.get(cacheKey, async () => {
    // ✅ SECURITY FIX: Get accessible institute IDs first
    const accessibleInstituteIds = await getAccessibleInstituteIds(req.user);
    
    if (accessibleInstituteIds.length === 0 && !req.user.permissions.isSuperAdmin) {
      return {
        totalUsers: 0,
        totalVideos: 0,
        totalInstitutes: 0,
        monthlyViews: "0",
        usersChange: "+0%",
        videosChange: "+0%", 
        institutesChange: "+0%",
        viewsChange: "+0%",
        dashboard: {
          overview: {
            total_users: 0,
            total_institutes: 0,
            total_videos: 0,
            active_users: 0,
            new_users_30d: 0,
            engagement_rate: "0%"
          },
          user_stats: {
            by_role: {},
            active_percentage: "0",
            new_last_7_days: 0,
            active_last_7_days: 0
          },
          video_engagement: {
            total_video_views: 0,
            completed_videos: 0,
            average_completion: 0,
            views_last_30_days: 0
          },
          video_stats: {
            total_views: 0,
            active_videos: 0,
            new_videos_30_days: 0
          },
          growth: {
            new_users_this_month: 0,
            user_growth_rate: "0%",
            engagement_trend: "stable"
          }
        }
      };
    }

    // ✅ SECURITY FIX: Apply scoped queries for basic counts
    let usersQuery = supabase.from('users').select('*', { count: 'exact', head: true });
    let institutesQuery = supabase.from('institutes').select('*', { count: 'exact', head: true });
    let videosQuery = supabase.from('video_content').select('*', { count: 'exact', head: true });

    // Apply scope filtering
    usersQuery = applyScopeFiltersToQuery(usersQuery, req.user, 'users');
    institutesQuery = applyScopeFiltersToQuery(institutesQuery, req.user, 'institutes');
    videosQuery = applyScopeFiltersToQuery(videosQuery, req.user, 'video_content');

    const [usersResult, institutesResult, videosResult] = await Promise.all([
      usersQuery,
      institutesQuery, 
      videosQuery
    ]);

    // Check for errors in basic queries
    if (usersResult.error) throw new Error(`Users query failed: ${usersResult.error.message}`);
    if (institutesResult.error) throw new Error(`Institutes query failed: ${institutesResult.error.message}`);
    if (videosResult.error) throw new Error(`Videos query failed: ${videosResult.error.message}`);

    // ✅ SECURITY FIX: Get detailed user data with scope filtering
    let detailedUsersQuery = supabase
      .from('users')
      .select('role, status, created_at, last_login');
    
    detailedUsersQuery = applyScopeFiltersToQuery(detailedUsersQuery, req.user, 'users');
    const { data: users, error: usersError } = await detailedUsersQuery;

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

    // ✅ SECURITY FIX: Get video engagement data with scope filtering
    let videoEngagement = {
      total_video_views: 0,
      completed_videos: 0,
      average_completion: 0,
      views_last_30_days: 0
    };

    try {
      // ✅ SECURITY FIX: Filter progress data by accessible users
      let progressQuery = supabase
        .from('student_progress')
        .select('watch_percentage, completed, video_id, created_at, user_id');
      
      // If not super admin, filter by users in accessible institutes
      if (!req.user.permissions.isSuperAdmin && accessibleInstituteIds.length > 0) {
        const { data: accessibleUsers } = await supabase
          .from('users')
          .select('id')
          .in('institute_id', accessibleInstituteIds);
        
        if (accessibleUsers && accessibleUsers.length > 0) {
          const userIds = accessibleUsers.map(u => u.id);
          progressQuery = progressQuery.in('user_id', userIds);
        }
      }

      const { data: progressData, error: progressError } = await progressQuery;

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

    // ✅ SECURITY FIX: Get video statistics with scope filtering
    let videoStatsQuery = supabase
      .from('video_content')
      .select('view_count, status, category, created_at');
    
    videoStatsQuery = applyScopeFiltersToQuery(videoStatsQuery, req.user, 'video_content');
    const { data: videos, error: videosError } = await videoStatsQuery;

    if (videosError) throw new Error(`Video stats query failed: ${videosError.message}`);

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

    return {
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
      }
    };
  });

  res.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString()
  });
});

// ✅ ENHANCED: getUserEngagement with role-based scoping
const getUserEngagement = asyncHandler(async (req, res) => {
  const cacheKey = statsCache.createKey('analytics:user-engagement', {
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await statsCache.get(cacheKey, async () => {
    // ✅ SECURITY FIX: Get user login frequency with scope filtering
    let usersQuery = supabase
      .from('users')
      .select('last_login, created_at, role');

    usersQuery = applyScopeFiltersToQuery(usersQuery, req.user, 'users');
    const { data: users, error: usersError } = await usersQuery;

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

    return {
      active_last_week: activeLastWeek,
      active_last_month: activeLastMonth,
      total_users: users.length,
      engagement_rate_week: users.length > 0 
        ? ((activeLastWeek / users.length) * 100).toFixed(1)
        : 0,
      engagement_rate_month: users.length > 0 
        ? ((activeLastMonth / users.length) * 100).toFixed(1)
        : 0
    };
  });

  res.json({
    success: true,
    engagement: result,
    timestamp: new Date().toISOString()
  });
});

// ✅ ENHANCED: getVideoPerformance with scope-aware progress data
const getVideoPerformance = asyncHandler(async (req, res) => {
  const cacheKey = statsCache.createKey('analytics:video-performance', {
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await statsCache.get(cacheKey, async () => {
    // ✅ SECURITY FIX: Get video performance data (videos themselves are not scoped yet)
    let videoQuery = supabase
      .from('video_content')
      .select(`
        id, title, view_count, like_count, category, difficulty_level
      `);

    videoQuery = applyScopeFiltersToQuery(videoQuery, req.user, 'video_content');
    const { data: videoData, error: videoError } = await videoQuery;

    if (videoError) throw new Error(`Video performance query failed: ${videoError.message}`);

    // ✅ SECURITY FIX: Get progress data filtered by accessible users
    let progressDataMap = {};
    try {
      let progressQuery = supabase
        .from('student_progress')
        .select('video_id, watch_percentage, completed, user_id');

      // If not super admin, filter by users in accessible institutes
      if (!req.user.permissions.isSuperAdmin) {
        const accessibleInstituteIds = await getAccessibleInstituteIds(req.user);
        
        if (accessibleInstituteIds.length > 0) {
          const { data: accessibleUsers } = await supabase
            .from('users')
            .select('id')
            .in('institute_id', accessibleInstituteIds);
          
          if (accessibleUsers && accessibleUsers.length > 0) {
            const userIds = accessibleUsers.map(u => u.id);
            progressQuery = progressQuery.in('user_id', userIds);
          }
        } else {
          // No accessible users, return empty progress data
          progressDataMap = {};
        }
      }

      const { data: progressData, error: progressError } = await progressQuery;

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

    return videoPerformance;
  });

  res.json({
    success: true,
    video_performance: result,
    timestamp: new Date().toISOString()
  });
});

// ✅ ENHANCED: getInstitutePerformance with proper scope filtering
const getInstitutePerformance = asyncHandler(async (req, res) => {
  const { institute_id } = req.query;

  // ✅ SECURITY FIX: Validate institute_id access if provided
  if (institute_id) {
    const accessibleInstituteIds = await getAccessibleInstituteIds(req.user);
    
    if (!accessibleInstituteIds.includes(parseInt(institute_id))) {
      return formatErrorResponse(res, 
        new Error('Access denied: Institute not in your scope'), 
        'institute performance', 403);
    }
  }

  const cacheKey = statsCache.createKey('analytics:institute-performance', {
    institute_id,
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await statsCache.get(cacheKey, async () => {
    // ✅ SECURITY FIX: Get institute data with scope filtering
    let instituteQuery = supabase
      .from('institutes')
      .select(`
        *,
        users(id, role, status, last_login)
      `);

    // Apply scope filtering first
    instituteQuery = applyScopeFiltersToQuery(instituteQuery, req.user, 'institutes');

    // Then apply specific institute filter if requested
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

    return institutePerformance;
  });

  res.json({
    success: true,
    institute_performance: result,
    timestamp: new Date().toISOString()
  });
});

// ✅ ENHANCED: exportAnalyticsData with scope filtering
const exportAnalyticsData = asyncHandler(async (req, res) => {
  const { 
    type = 'dashboard', 
    format = 'json',
    start_date,
    end_date 
  } = req.query;

  let data;

  switch (type) {
    case 'dashboard':
      // ✅ SECURITY FIX: Get dashboard data with scope filtering
      let usersQuery = supabase.from('users').select('*');
      let videosQuery = supabase.from('video_content').select('*');
      let institutesQuery = supabase.from('institutes').select('*');

      // Apply scope filtering
      usersQuery = applyScopeFiltersToQuery(usersQuery, req.user, 'users');
      videosQuery = applyScopeFiltersToQuery(videosQuery, req.user, 'video_content');
      institutesQuery = applyScopeFiltersToQuery(institutesQuery, req.user, 'institutes');

      const [usersResult, videosResult, institutesResult] = await Promise.all([
        usersQuery,
        videosQuery,
        institutesQuery
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
          generated_at: new Date().toISOString(),
          scope: {
            user_role: req.user.role,
            institute_id: req.user.institute_id,
            zone_id: req.user.zone_id
          }
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
});

module.exports = {
  getDashboardStats,
  getUserEngagement,
  getVideoPerformance,
  getInstitutePerformance,
  exportAnalyticsData
};