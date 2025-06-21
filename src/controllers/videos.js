const YouTubeService = require('../services/youtube-service');
const { supabase } = require('../config/database');

const getAllVideos = async (req, res) => {
  try {
    const { 
      category, 
      difficulty, 
      page = 1, 
      limit = 20, 
      search 
    } = req.query;

    let query = supabase
      .from('video_content')
      .select('*')
      .eq('status', 'active');

    if (category) {
      query = query.eq('category', category);
    }

    if (difficulty) {
      query = query.eq('difficulty_level', difficulty);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Add pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    query = query
      .order('course_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data: videos, error, count } = await query;

    if (error) throw error;

    // Add embed URLs to videos
    const videosWithEmbeds = videos.map(video => ({
      ...video,
      embedUrl: YouTubeService.getEmbedUrl(video.youtube_video_id),
      thumbnailUrl: YouTubeService.getThumbnailUrl(video.youtube_video_id)
    }));

    res.json({
      success: true,
      data: {
        videos: videosWithEmbeds,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getVideoById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: video, error } = await supabase
      .from('video_content')
      .select('*')
      .eq('id', id)
      .eq('status', 'active')
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Video not found'
      });
    }

    // Add embed URL and enhanced thumbnail
    video.embedUrl = YouTubeService.getEmbedUrl(video.youtube_video_id);
    video.thumbnailUrl = YouTubeService.getThumbnailUrl(video.youtube_video_id);

    res.json({
      success: true,
      data: { video }
    });

  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const addVideoFromYouTube = async (req, res) => {
  try {
    const { youtubeVideoId, category, difficulty, courseOrder, tags } = req.body;

    if (!youtubeVideoId) {
      return res.status(400).json({
        success: false,
        message: 'YouTube video ID is required'
      });
    }

    // Sync video from YouTube to database
    const video = await YouTubeService.syncVideoToDatabase(youtubeVideoId);

    // Update additional fields if provided
    if (category || difficulty || courseOrder || tags) {
      const updateData = {};
      if (category) updateData.category = category;
      if (difficulty) updateData.difficulty_level = difficulty;
      if (courseOrder) updateData.course_order = courseOrder;
      if (tags) updateData.tags = tags;

      const { data: updatedVideo, error } = await supabase
        .from('video_content')
        .update(updateData)
        .eq('youtube_video_id', youtubeVideoId)
        .select()
        .single();

      if (error) throw error;
      
      res.status(201).json({
        success: true,
        message: 'Video added successfully',
        data: { video: updatedVideo }
      });
    } else {
      res.status(201).json({
        success: true,
        message: 'Video added successfully',
        data: { video }
      });
    }

  } catch (error) {
    console.error('Add video error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

const searchYouTubeVideos = async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const videos = await YouTubeService.searchVideos(query, maxResults);

    res.json({
      success: true,
      data: { videos },
      quota: {
        used: YouTubeService.getQuotaUsed(),
        remaining: YouTubeService.getQuotaRemaining()
      }
    });

  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

const getVideoCategories = async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('video_content')
      .select('category')
      .eq('status', 'active')
      .group('category');

    if (error) throw error;

    const uniqueCategories = [...new Set(categories.map(item => item.category))];

    res.json({
      success: true,
      data: { categories: uniqueCategories }
    });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getAllVideos,
  getVideoById,
  addVideoFromYouTube,
  searchYouTubeVideos,
  getVideoCategories
};