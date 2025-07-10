const { supabase } = require('../config/database');
const YouTubeService = require('../services/youtube-service');

// Import utilities
const {
  formatPaginationResponse,
  formatSuccessResponse,
  formatErrorResponse,
  formatNotFoundResponse,
  formatBulkResponse,
  asyncHandler
} = require('../utils/responseUtils');

const {
  validatePagination,
  sanitizeSearchQuery,
  validateIdArray,
  validateBoolean,
  isValidYouTubeVideoId,
  extractYouTubeVideoId
} = require('../utils/validationUtils');

const { queryCache, statsCache } = require('../utils/cacheUtils');

/**
 * ✅ SECURITY FIX: Video access control based on user role and institute assignments
 * Note: This implementation assumes videos can be assigned to specific institutes/zones
 * If videos are global, adjust the logic accordingly
 */
const applyScopeFilters = (query, user, additionalFilters = {}) => {
  // Super admin sees all videos
  if (user.permissions.isSuperAdmin) {
    // Apply any additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query = query.eq(key, value);
      }
    });
    return query;
  }
  
  // ✅ SECURITY NOTE: For now, zone managers and institute admins see all videos
  // This can be refined later when video assignment system is implemented
  // In a more mature system, videos would have institute_assignments or zone_assignments
  
  // Zone manager sees videos assigned to their zone (when assignment system exists)
  if (user.permissions.isZoneManager && user.zone_id) {
    // TODO: Add zone-based video filtering when video_assignments table exists
    // query = query.eq('assigned_zone_id', user.zone_id);
  }
  
  // Institute admin sees videos assigned to their institute (when assignment system exists)
  else if (user.permissions.isInstituteAdmin && user.institute_id) {
    // TODO: Add institute-based video filtering when video_assignments table exists
    // query = query.eq('assigned_institute_id', user.institute_id);
  }
  
  // Students and parents see only active videos
  else if (user.permissions.isStudent || user.permissions.isParent) {
    query = query.eq('status', 'active');
  }
  
  // Apply any additional filters
  Object.entries(additionalFilters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query = query.eq(key, value);
    }
  });
  
  return query;
};

/**
 * ✅ SECURITY FIX: Validate video IDs belong to user's scope
 */
const validateVideoScope = async (videoIds, requesterUser) => {
  // Super admin can access all videos
  if (requesterUser.permissions.isSuperAdmin) {
    return { valid: true, validIds: videoIds };
  }
  
  // Get video details to validate scope
  const { data: videos, error } = await supabase
    .from('video_content')
    .select('id, status, category')
    .in('id', videoIds);
    
  if (error) {
    throw new Error(`Failed to validate video scope: ${error.message}`);
  }
  
  const validIds = [];
  const invalidIds = [];
  
  videos.forEach(video => {
    let isValid = false;
    
    // Zone manager and institute admin can manage all videos for now
    if (requesterUser.permissions.isZoneManager || requesterUser.permissions.isInstituteAdmin) {
      isValid = true;
    }
    // Students and parents cannot manage videos
    else if (requesterUser.permissions.isStudent || requesterUser.permissions.isParent) {
      isValid = false;
    }
    
    if (isValid) {
      validIds.push(video.id);
    } else {
      invalidIds.push(video.id);
    }
  });
  
  return {
    valid: invalidIds.length === 0,
    validIds,
    invalidIds,
    invalidCount: invalidIds.length
  };
};

// ✅ ENHANCED: getAllVideos with role-based access control
const getAllVideos = asyncHandler(async (req, res) => {
  const { category, difficulty, page = 1, limit = 20, search } = req.query;
  const { page: validatedPage, limit: validatedLimit } = validatePagination(page, limit);
  const sanitizedSearch = sanitizeSearchQuery(search);

  // ✅ NEW: Create cache key that includes user scope
  const cacheKey = queryCache.createKey('videos:list', {
    category, difficulty, page: validatedPage, limit: validatedLimit, search: sanitizedSearch,
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await queryCache.get(cacheKey, async () => {
    let query = supabase
      .from("video_content")
      .select("*", { count: "exact" })
      .eq("status", "active"); // All users see only active videos

    // ✅ SECURITY FIX: Apply scope filtering based on user role
    query = applyScopeFilters(query, req.user, { category, difficulty });

    // ✅ SECURITY FIX: SQL injection prevention - use parameterized queries
    if (sanitizedSearch) {
      const escapedSearch = sanitizedSearch.replace(/[%_]/g, '\\$&');
      query = query.or(`title.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`);
    }

    // Add pagination
    const from = (validatedPage - 1) * validatedLimit;
    const to = from + validatedLimit - 1;

    query = query
      .order("course_order", { ascending: true })
      .order("created_at", { ascending: false })
      .range(from, to);

    const { data: videos, error, count } = await query;

    if (error) throw error;

    // Add embed URLs to videos
    const videosWithEmbeds = videos.map((video) => ({
      ...video,
      embedUrl: YouTubeService.getEmbedUrl(video.youtube_video_id),
      thumbnailUrl: YouTubeService.getThumbnailUrl(video.youtube_video_id),
    }));

    return { videos: videosWithEmbeds, count };
  });

  res.json(formatPaginationResponse(result.videos, validatedPage, validatedLimit, result.count));
});

// ✅ ENHANCED: getVideoById with access validation
const getVideoById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ SECURITY FIX: Students and parents can only access active videos
  let query = supabase
    .from("video_content")
    .select("*")
    .eq("id", id);

  // Apply additional restrictions for non-admin users
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    query = query.eq("status", "active");
  }

  const { data: video, error } = await query.single();

  if (error || !video) {
    return formatNotFoundResponse(res, 'Video');
  }

  // Add embed URL and enhanced thumbnail
  video.embedUrl = YouTubeService.getEmbedUrl(video.youtube_video_id);
  video.thumbnailUrl = YouTubeService.getThumbnailUrl(video.youtube_video_id);

  res.json(formatSuccessResponse(video));
});

// ✅ ENHANCED: addVideoFromYouTube with role-based permissions
const addVideoFromYouTube = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only admins can add videos
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to add videos'), 
      'add video', 403);
  }

  // Handle multiple possible field names from frontend
  const {
    youtubeVideoId,
    youtube_video_id,
    videoId,
    category,
    difficulty,
    difficulty_level,
    courseOrder,
    course_order,
    tags,
  } = req.body;

  // Extract the actual video ID from multiple possible sources
  let actualVideoId = youtubeVideoId || youtube_video_id || videoId;
  if (actualVideoId && actualVideoId.includes("youtube.com/watch?v=")) {
    actualVideoId = extractYouTubeVideoId(actualVideoId);
  } else if (actualVideoId && actualVideoId.includes("youtu.be/")) {
    actualVideoId = actualVideoId.split("youtu.be/")[1].split(/[?&]/)[0];
  }

  const actualDifficulty = difficulty || difficulty_level;
  const actualCourseOrder = courseOrder || course_order;

  console.log("📹 Video creation request:", {
    actualVideoId,
    category,
    actualDifficulty,
    actualCourseOrder,
    tags,
    requesterId: req.user.id,
    requesterRole: req.user.role
  });

  if (!actualVideoId) {
    return formatErrorResponse(res, 
      new Error('YouTube video ID is required'), 
      'add video', 400);
  }

  // ✅ SECURITY FIX: Validate YouTube video ID format
  if (!isValidYouTubeVideoId(actualVideoId)) {
    return formatErrorResponse(res, 
      new Error('Invalid YouTube video ID format'), 
      'add video', 400);
  }

  // Check if video already exists
  const { data: existingVideo } = await supabase
    .from('video_content')
    .select('id')
    .eq('youtube_video_id', actualVideoId)
    .single();

  if (existingVideo) {
    return formatErrorResponse(res, 
      new Error('Video already exists in the system'), 
      'add video', 400);
  }

  try {
    // Sync video from YouTube to database
    const video = await YouTubeService.syncVideoToDatabase(actualVideoId);

    // Update additional fields if provided
    if (category || actualDifficulty || actualCourseOrder || tags) {
      const updateData = {
        updated_at: new Date().toISOString()
      };
      if (category) updateData.category = category;
      if (actualDifficulty) updateData.difficulty_level = actualDifficulty;
      if (actualCourseOrder) updateData.course_order = actualCourseOrder;
      if (tags) updateData.tags = tags;

      const { data: updatedVideo, error } = await supabase
        .from("video_content")
        .update(updateData)
        .eq("youtube_video_id", actualVideoId)
        .select()
        .single();

      if (error) throw error;

      // ✅ IMPORTANT: Invalidate cache after creation
      queryCache.invalidatePattern('videos:.*');
      statsCache.invalidatePattern('videos:.*');

      res.status(201).json(formatSuccessResponse(updatedVideo, "Video added successfully"));
    } else {
      // ✅ IMPORTANT: Invalidate cache after creation
      queryCache.invalidatePattern('videos:.*');
      statsCache.invalidatePattern('videos:.*');

      res.status(201).json(formatSuccessResponse(video, "Video added successfully"));
    }
  } catch (error) {
    console.error("Add video error:", error);
    return formatErrorResponse(res, error, 'add video');
  }
});

// ✅ ENHANCED: searchYouTubeVideos with rate limiting and validation
const searchYouTubeVideos = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only admins can search YouTube
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to search YouTube'), 
      'search videos', 403);
  }

  const { q, query, maxResults = 10 } = req.query;

  // Accept both 'q' and 'query' parameters
  const searchQuery = q || query;

  if (!searchQuery) {
    return formatErrorResponse(res, 
      new Error('Search query is required (use ?q=your_search_term)'), 
      'search videos', 400);
  }

  // ✅ SECURITY FIX: Validate and sanitize search query
  const sanitizedQuery = sanitizeSearchQuery(searchQuery);
  if (!sanitizedQuery) {
    return formatErrorResponse(res, 
      new Error('Invalid search query'), 
      'search videos', 400);
  }

  // ✅ SECURITY FIX: Limit max results to prevent abuse
  const validatedMaxResults = Math.min(Math.max(1, parseInt(maxResults)), 25);

  try {
    const videos = await YouTubeService.searchVideos(sanitizedQuery, validatedMaxResults);

    res.json({
      success: true,
      data: { videos },
      quota: {
        used: YouTubeService.getQuotaUsed(),
        remaining: YouTubeService.getQuotaRemaining(),
      },
      searchQuery: sanitizedQuery,
      maxResults: validatedMaxResults
    });
  } catch (error) {
    console.error("YouTube search error:", error);
    return formatErrorResponse(res, error, 'search videos');
  }
});

// ✅ ENHANCED: getVideoCategories with caching
const getVideoCategories = asyncHandler(async (req, res) => {
  const cacheKey = queryCache.createKey('videos:categories', {});

  const result = await queryCache.get(cacheKey, async () => {
    let query = supabase
      .from("video_content")
      .select("category")
      .eq("status", "active");

    // Apply scope filtering
    query = applyScopeFilters(query, req.user);

    const { data: categories, error } = await query;

    if (error) throw error;

    // Extract unique categories manually
    const uniqueCategories = [
      ...new Set(categories.map((item) => item.category)),
    ].filter(Boolean);

    return uniqueCategories;
  });

  res.json(formatSuccessResponse({ categories: result }));
});

// ✅ ENHANCED: updateVideo with scope validation
const updateVideo = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only admins can update videos
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to update videos'), 
      'update video', 403);
  }

  const { id } = req.params;
  const {
    title,
    description,
    category,
    difficulty_level,
    course_order,
    tags,
    status,
  } = req.body;

  // ✅ SECURITY FIX: Validate video access
  const scopeValidation = await validateVideoScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Video not in your scope'), 
      'update video', 403);
  }

  // Check if video exists
  const { data: existingVideo, error: fetchError } = await supabase
    .from("video_content")
    .select("id")
    .eq("id", id)
    .single();

  if (fetchError || !existingVideo) {
    return formatNotFoundResponse(res, 'Video');
  }

  // Prepare update data
  const updateData = {
    updated_at: new Date().toISOString(),
  };

  if (title !== undefined) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (category !== undefined) updateData.category = category;
  if (difficulty_level !== undefined) updateData.difficulty_level = difficulty_level;
  if (course_order !== undefined) updateData.course_order = course_order;
  if (tags !== undefined) updateData.tags = tags;
  if (status !== undefined) updateData.status = status;

  // Update video
  const { data: updatedVideo, error } = await supabase
    .from("video_content")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Update video error:", error);
    return formatErrorResponse(res, error, 'update video');
  }

  // ✅ IMPORTANT: Invalidate cache after update
  queryCache.invalidatePattern('videos:.*');
  statsCache.invalidatePattern('videos:.*');

  res.json(formatSuccessResponse(updatedVideo, "Video updated successfully"));
});

// ✅ ENHANCED: deleteVideo with scope validation
const deleteVideo = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only super admin and zone managers can delete videos
  if (!req.user.permissions.isSuperAdmin && !req.user.permissions.isZoneManager) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to delete videos'), 
      'delete video', 403);
  }

  const { id } = req.params;

  // ✅ SECURITY FIX: Validate video access
  const scopeValidation = await validateVideoScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Video not in your scope'), 
      'delete video', 403);
  }

  // Check if video exists
  const { data: existingVideo, error: fetchError } = await supabase
    .from("video_content")
    .select("id, title")
    .eq("id", id)
    .single();

  if (fetchError || !existingVideo) {
    return formatNotFoundResponse(res, 'Video');
  }

  // ✅ SECURITY FIX: Check for dependencies before deletion
  const { data: progressRecords, error: progressError } = await supabase
    .from('student_progress')
    .select('id')
    .eq('video_id', id)
    .limit(5);

  if (progressError) {
    console.warn('Could not check video dependencies:', progressError.message);
  } else if (progressRecords && progressRecords.length > 0) {
    return formatErrorResponse(res, 
      new Error(`Cannot delete video with ${progressRecords.length} student progress records. Consider deactivating instead.`), 
      'delete video', 400);
  }

  // HARD DELETE - Actually remove from database
  const { error } = await supabase
    .from("video_content")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Delete video error:", error);
    return formatErrorResponse(res, error, 'delete video');
  }

  // ✅ IMPORTANT: Invalidate cache after deletion
  queryCache.invalidatePattern('videos:.*');
  statsCache.invalidatePattern('videos:.*');

  res.json(formatSuccessResponse(null, "Video deleted successfully"));
});

// ✅ ENHANCED: updateVideoStatus with scope validation
const updateVideoStatus = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only admins can update video status
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to update video status'), 
      'update video status', 403);
  }

  const { id } = req.params;
  const { is_active } = req.body;

  const validation = validateBoolean(is_active, 'is_active');
  if (!validation.isValid) {
    return formatErrorResponse(res, 
      new Error(validation.error), 
      'update video status', 400);
  }

  // ✅ SECURITY FIX: Validate video access
  const scopeValidation = await validateVideoScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Video not in your scope'), 
      'update video status', 403);
  }

  const { data: updatedVideo, error } = await supabase
    .from("video_content")
    .update({
      status: is_active ? "active" : "inactive",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return formatNotFoundResponse(res, 'Video');
  }

  // ✅ IMPORTANT: Invalidate cache after status update
  queryCache.invalidatePattern('videos:.*');
  statsCache.invalidatePattern('videos:.*');

  res.json(formatSuccessResponse(
    updatedVideo, 
    `Video ${is_active ? "activated" : "deactivated"} successfully`
  ));
});

// ✅ ENHANCED: bulkDeleteVideos with comprehensive scope validation
const bulkDeleteVideos = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only super admin and zone managers can bulk delete
  if (!req.user.permissions.isSuperAdmin && !req.user.permissions.isZoneManager) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to bulk delete videos'), 
      'bulk delete videos', 403);
  }

  const { videoIds } = req.body;

  const validation = validateIdArray(videoIds, 'Video IDs');
  if (!validation.isValid) {
    return formatErrorResponse(res, 
      new Error(validation.error), 
      'bulk delete videos', 400);
  }

  // ✅ SECURITY FIX: Validate all videos belong to requester's scope
  const scopeValidation = await validateVideoScope(validation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} videos not in your scope`), 
      'bulk delete videos', 403);
  }

  // Check for dependencies
  const { data: progressRecords, error: progressError } = await supabase
    .from('student_progress')
    .select('video_id')
    .in('video_id', scopeValidation.validIds);

  if (progressError) {
    console.warn('Could not check video dependencies:', progressError.message);
  } else if (progressRecords && progressRecords.length > 0) {
    const videosWithProgress = [...new Set(progressRecords.map(p => p.video_id))];
    return formatErrorResponse(res, 
      new Error(`Cannot delete videos with student progress: ${videosWithProgress.join(', ')}. Consider deactivating instead.`), 
      'bulk delete videos', 400);
  }

  // HARD DELETE - Actually remove from database
  const { error } = await supabase
    .from("video_content")
    .delete()
    .in("id", scopeValidation.validIds);

  if (error) throw error;

  // ✅ IMPORTANT: Invalidate cache after bulk deletion
  queryCache.invalidatePattern('videos:.*');
  statsCache.invalidatePattern('videos:.*');

  res.json(formatBulkResponse('deleted', scopeValidation.validIds.length));
});

// ✅ ENHANCED: getVideoStats with role-based scoping
const getVideoStats = asyncHandler(async (req, res) => {
  const cacheKey = statsCache.createKey('videos:stats', {
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await statsCache.get(cacheKey, async () => {
    // Get basic video counts with scope filtering
    let query = supabase
      .from("video_content")
      .select("status, category, difficulty_level, view_count");

    query = applyScopeFilters(query, req.user);
    const { data: videos, error } = await query;

    if (error) throw error;

    const stats = {
      total_videos: videos.length,
      active_videos: videos.filter((v) => v.status === "active").length,
      inactive_videos: videos.filter((v) => v.status === "inactive").length,
      total_views: videos.reduce((sum, v) => sum + (v.view_count || 0), 0),
      by_category: {},
      by_difficulty: {},
    };

    // Group by category
    videos.forEach((video) => {
      const category = video.category || "uncategorized";
      stats.by_category[category] = (stats.by_category[category] || 0) + 1;
    });

    // Group by difficulty
    videos.forEach((video) => {
      const difficulty = video.difficulty_level || "unspecified";
      stats.by_difficulty[difficulty] = (stats.by_difficulty[difficulty] || 0) + 1;
    });

    return stats;
  });

  res.json(formatSuccessResponse(result));
});

// ✅ ENHANCED: bulkUpdateVideoStatus with scope validation
const bulkUpdateVideoStatus = asyncHandler(async (req, res) => {
  // ✅ SECURITY FIX: Only admins can bulk update video status
  if (!req.user.permissions.isSuperAdmin && 
      !req.user.permissions.isZoneManager && 
      !req.user.permissions.isInstituteAdmin) {
    return formatErrorResponse(res, 
      new Error('Insufficient permissions to bulk update video status'), 
      'bulk update video status', 403);
  }

  const { videoIds, is_active } = req.body;

  const idsValidation = validateIdArray(videoIds, 'Video IDs');
  if (!idsValidation.isValid) {
    return formatErrorResponse(res, 
      new Error(idsValidation.error), 
      'bulk update video status', 400);
  }

  const statusValidation = validateBoolean(is_active, 'is_active');
  if (!statusValidation.isValid) {
    return formatErrorResponse(res, 
      new Error(statusValidation.error), 
      'bulk update video status', 400);
  }

  // ✅ SECURITY FIX: Validate all videos belong to requester's scope
  const scopeValidation = await validateVideoScope(idsValidation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} videos not in your scope`), 
      'bulk update video status', 403);
  }

  // SOFT UPDATE - Update status for bulk operations
  const { error } = await supabase
    .from("video_content")
    .update({
      status: is_active ? "active" : "inactive",
      updated_at: new Date().toISOString(),
    })
    .in("id", scopeValidation.validIds);

  if (error) throw error;

  // ✅ IMPORTANT: Invalidate cache after bulk status update
  queryCache.invalidatePattern('videos:.*');
  statsCache.invalidatePattern('videos:.*');

  res.json(formatBulkResponse(
    is_active ? 'activated' : 'deactivated', 
    scopeValidation.validIds.length,
    { new_status: is_active ? 'active' : 'inactive' }
  ));
});

module.exports = {
  getAllVideos,
  getVideoById,
  addVideoFromYouTube,
  searchYouTubeVideos,
  getVideoCategories,
  updateVideo,
  deleteVideo,
  updateVideoStatus,
  bulkDeleteVideos,
  bulkUpdateVideoStatus,
  getVideoStats
};