const YouTubeService = require("../services/youtube-service");
const { supabase } = require("../config/database");

// FIXED: Added proper pagination count
// REPLACE THE getAllVideos FUNCTION IN YOUR videos controller

const getAllVideos = async (req, res) => {
  try {
    const { category, difficulty, page = 1, limit = 20, search } = req.query;

    let query = supabase
      .from("video_content")
      .select("*", { count: "exact" }) // FIXED: Added count parameter
      .eq("status", "active");

    if (category) {
      query = query.eq("category", category);
    }

    if (difficulty) {
      query = query.eq("difficulty_level", difficulty);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Add pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

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

    // FIXED: Match the same format as Users and Institutes controllers
    res.json({
      success: true,
      data: videosWithEmbeds, // FIXED: Direct array, not nested under 'videos'
      pagination: {
        currentPage: parseInt(page), // FIXED: currentPage not page
        totalPages: Math.ceil(count / limit), // FIXED: totalPages not pages
        totalItems: count, // FIXED: totalItems not total
        pageSize: parseInt(limit), // FIXED: pageSize not limit
      },
    });
  } catch (error) {
    console.error("Get videos error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getVideoById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: video, error } = await supabase
      .from("video_content")
      .select("*")
      .eq("id", id)
      .eq("status", "active")
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    // Add embed URL and enhanced thumbnail
    video.embedUrl = YouTubeService.getEmbedUrl(video.youtube_video_id);
    video.thumbnailUrl = YouTubeService.getThumbnailUrl(video.youtube_video_id);

    res.json({
      success: true,
      data: { video },
    });
  } catch (error) {
    console.error("Get video error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const addVideoFromYouTube = async (req, res) => {
  try {
    // ENHANCED: Handle multiple possible field names from frontend
    const { 
      youtubeVideoId, 
      youtube_video_id,
      videoId,
      category, 
      difficulty, 
      difficulty_level,
      courseOrder, 
      course_order,
      tags 
    } = req.body;

    // Extract the actual video ID from multiple possible sources
    const actualVideoId = youtubeVideoId || youtube_video_id || videoId;
    const actualDifficulty = difficulty || difficulty_level;
    const actualCourseOrder = courseOrder || course_order;

    console.log('📹 Video creation request:', {
      actualVideoId,
      category,
      actualDifficulty,
      actualCourseOrder,
      tags,
      originalBody: req.body
    });

    if (!actualVideoId) {
      return res.status(400).json({
        success: false,
        message: "YouTube video ID is required",
      });
    }

    // Sync video from YouTube to database
    const video = await YouTubeService.syncVideoToDatabase(actualVideoId);

    // Update additional fields if provided
    if (category || actualDifficulty || actualCourseOrder || tags) {
      const updateData = {};
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

      res.status(201).json({
        success: true,
        message: "Video added successfully",
        data: { video: updatedVideo },
      });
    } else {
      res.status(201).json({
        success: true,
        message: "Video added successfully",
        data: { video },
      });
    }
  } catch (error) {
    console.error("Add video error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// FIXED: Accept both 'q' and 'query' parameters for YouTube search
const searchYouTubeVideos = async (req, res) => {
  try {
    const { q, query, maxResults = 10 } = req.query;

    // FIXED: Accept both 'q' and 'query' parameters
    const searchQuery = q || query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: "Search query is required (use ?q=your_search_term)",
      });
    }

    const videos = await YouTubeService.searchVideos(searchQuery, maxResults);

    res.json({
      success: true,
      data: { videos },
      quota: {
        used: YouTubeService.getQuotaUsed(),
        remaining: YouTubeService.getQuotaRemaining(),
      },
    });
  } catch (error) {
    console.error("YouTube search error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

const getVideoCategories = async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from("video_content")
      .select("category")
      .eq("status", "active");

    if (error) throw error;

    // Extract unique categories manually
    const uniqueCategories = [
      ...new Set(categories.map((item) => item.category)),
    ].filter(Boolean);

    res.json({
      success: true,
      data: { categories: uniqueCategories },
    });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const updateVideo = async (req, res) => {
  try {
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

    // Check if video exists
    const { data: existingVideo, error: fetchError } = await supabase
      .from("video_content")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchError || !existingVideo) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (difficulty_level !== undefined)
      updateData.difficulty_level = difficulty_level;
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
      return res.status(500).json({
        success: false,
        message: "Failed to update video",
      });
    }

    res.json({
      success: true,
      message: "Video updated successfully",
      data: updatedVideo,
    });
  } catch (error) {
    console.error("Update video error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if video exists
    const { data: existingVideo, error: fetchError } = await supabase
      .from("video_content")
      .select("id, title")
      .eq("id", id)
      .single();

    if (fetchError || !existingVideo) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from("video_content")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Delete video error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete video",
      });
    }

    res.json({
      success: true,
      message: "Video deleted successfully",
    });
  } catch (error) {
    console.error("Delete video error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const updateVideoStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

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
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    res.json({
      success: true,
      message: `Video ${is_active ? "activated" : "deactivated"} successfully`,
      data: updatedVideo,
    });
  } catch (error) {
    console.error("Update video status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const bulkDeleteVideos = async (req, res) => {
  try {
    const { videoIds } = req.body;

    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Video IDs array is required",
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from("video_content")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .in("id", videoIds);

    if (error) throw error;

    res.json({
      success: true,
      message: `${videoIds.length} videos deleted successfully`,
    });
  } catch (error) {
    console.error("Bulk delete videos error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const getVideoStats = async (req, res) => {
  try {
    // Get basic video counts
    const { data: videos, error } = await supabase
      .from("video_content")
      .select("status, category, difficulty_level, view_count");

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
      stats.by_difficulty[difficulty] =
        (stats.by_difficulty[difficulty] || 0) + 1;
    });

    res.json({
      success: true,
      stats: stats,
    });
  } catch (error) {
    console.error("Get video stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

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
  getVideoStats,
};
