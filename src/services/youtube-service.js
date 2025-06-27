const { google } = require('googleapis');
const { supabase } = require('../config/database');

class YouTubeService {
  constructor() {
    this.youtube = google.youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY
    });
    this.quotaUsed = 0;
    this.quotaLimit = 10000; // Daily quota limit
  }

  // Search YouTube videos
  async searchVideos(query, maxResults = 10) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error('YouTube API key not configured');
      }

      const response = await this.youtube.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: maxResults,
        order: 'relevance',
        videoDefinition: 'any',
        videoEmbeddable: 'true'
      });

      this.quotaUsed += 100; // Search costs 100 quota units

      const videos = response.data.items.map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.maxresdefault?.url || 
                  item.snippet.thumbnails?.high?.url ||
                  item.snippet.thumbnails?.medium?.url,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId
      }));

      return videos;

    } catch (error) {
      console.error('YouTube search error:', error);
      throw new Error(`YouTube search failed: ${error.message}`);
    }
  }

  // Get video details by ID
  async getVideoDetails(videoId) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error('YouTube API key not configured');
      }

      const response = await this.youtube.videos.list({
        part: 'snippet,contentDetails,statistics',
        id: videoId
      });

      this.quotaUsed += 1; // Video details costs 1 quota unit

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('Video not found');
      }

      const video = response.data.items[0];
      
      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        thumbnail: video.snippet.thumbnails?.maxresdefault?.url || 
                  video.snippet.thumbnails?.high?.url ||
                  video.snippet.thumbnails?.medium?.url,
        duration: this.parseDuration(video.contentDetails.duration),
        publishedAt: video.snippet.publishedAt,
        channelTitle: video.snippet.channelTitle,
        channelId: video.snippet.channelId,
        viewCount: parseInt(video.statistics?.viewCount || 0),
        likeCount: parseInt(video.statistics?.likeCount || 0),
        tags: video.snippet.tags || []
      };

    } catch (error) {
      console.error('Get video details error:', error);
      throw new Error(`Failed to get video details: ${error.message}`);
    }
  }

  // Sync video to database
  async syncVideoToDatabase(youtubeVideoId) {
    try {
      // Get video details from YouTube
      const videoDetails = await this.getVideoDetails(youtubeVideoId);

      // Prepare data for database
      const videoData = {
        youtube_video_id: youtubeVideoId,
        title: videoDetails.title,
        description: videoDetails.description || '',
        duration: videoDetails.duration,
        view_count: videoDetails.viewCount,
        like_count: videoDetails.likeCount,
        channel_title: videoDetails.channelTitle,
        channel_id: videoDetails.channelId,
        published_at: videoDetails.publishedAt,
        tags: videoDetails.tags,
        category: 'general', // Default category
        difficulty_level: 'beginner', // Default difficulty
        status: 'active',
        created_at: new Date().toISOString()
      };

      // Insert into database
      const { data: insertedVideo, error } = await supabase
        .from('video_content')
        .insert(videoData)
        .select()
        .single();

      if (error) {
        throw new Error(`Database insert failed: ${error.message}`);
      }

      return insertedVideo;

    } catch (error) {
      console.error('Sync video to database error:', error);
      throw error;
    }
  }

  // Get embed URL
  getEmbedUrl(youtubeVideoId) {
    return `https://www.youtube.com/embed/${youtubeVideoId}`;
  }

  // Get thumbnail URL
  getThumbnailUrl(youtubeVideoId, quality = 'maxresdefault') {
    return `https://img.youtube.com/vi/${youtubeVideoId}/${quality}.jpg`;
  }

  // Parse YouTube duration format (PT4M13S -> 4:13)
  parseDuration(duration) {
    if (!duration) return '0:00';

    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return '0:00';

    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // Get current quota usage
  getQuotaUsed() {
    return this.quotaUsed;
  }

  // Get remaining quota
  getQuotaRemaining() {
    return this.quotaLimit - this.quotaUsed;
  }

  // Reset quota (call this daily)
  resetQuota() {
    this.quotaUsed = 0;
  }

  // Check if quota is available
  hasQuotaAvailable(cost = 1) {
    return (this.quotaUsed + cost) <= this.quotaLimit;
  }

  // Validate YouTube video ID format
  isValidVideoId(videoId) {
    const regex = /^[a-zA-Z0-9_-]{11}$/;
    return regex.test(videoId);
  }

  // Extract video ID from YouTube URL
  extractVideoId(url) {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  // Batch import videos
  async batchImportVideos(videoIds) {
    const results = [];
    const errors = [];

    for (const videoId of videoIds) {
      try {
        if (!this.hasQuotaAvailable(101)) { // Search + details
          throw new Error('YouTube API quota exceeded');
        }

        const video = await this.syncVideoToDatabase(videoId);
        results.push(video);

      } catch (error) {
        errors.push({
          videoId,
          error: error.message
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      quotaUsed: this.getQuotaUsed(),
      quotaRemaining: this.getQuotaRemaining()
    };
  }

  // Get video categories from YouTube
  async getYouTubeCategories() {
    try {
      const response = await this.youtube.videoCategories.list({
        part: 'snippet',
        regionCode: 'US'
      });

      this.quotaUsed += 1;

      return response.data.items.map(item => ({
        id: item.id,
        title: item.snippet.title
      }));

    } catch (error) {
      console.error('Get YouTube categories error:', error);
      throw new Error(`Failed to get categories: ${error.message}`);
    }
  }

  // Search videos by category
  async searchByCategory(categoryId, maxResults = 10) {
    try {
      const response = await this.youtube.search.list({
        part: 'snippet',
        type: 'video',
        videoCategoryId: categoryId,
        maxResults: maxResults,
        order: 'relevance'
      });

      this.quotaUsed += 100;

      return response.data.items.map(item => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.high?.url,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle
      }));

    } catch (error) {
      console.error('Search by category error:', error);
      throw new Error(`Category search failed: ${error.message}`);
    }
  }
}

// Export singleton instance
module.exports = new YouTubeService();