const { google } = require('googleapis');
const { supabase } = require('../config/database');

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// YouTube API quota tracking
let apiQuotaUsed = 0;
const DAILY_QUOTA_LIMIT = 10000;

const checkQuota = (cost = 1) => {
  if (apiQuotaUsed + cost > DAILY_QUOTA_LIMIT) {
    throw new Error('YouTube API quota exceeded for today');
  }
  apiQuotaUsed += cost;
};

class YouTubeService {
  async getVideoDetails(videoId) {
    try {
      checkQuota(1); // Video details cost 1 quota unit
      
      const response = await youtube.videos.list({
        part: ['snippet', 'contentDetails', 'statistics'],
        id: [videoId]
      });

      if (response.data.items.length === 0) {
        throw new Error('Video not found');
      }

      const video = response.data.items[0];
      
      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        thumbnails: video.snippet.thumbnails,
        duration: this.parseDuration(video.contentDetails.duration),
        publishedAt: video.snippet.publishedAt,
        viewCount: parseInt(video.statistics.viewCount || 0),
        likeCount: parseInt(video.statistics.likeCount || 0)
      };
    } catch (error) {
      console.error('YouTube API Error:', error.message);
      throw new Error('Failed to fetch video details');
    }
  }

  async searchVideos(query, maxResults = 10) {
    try {
      checkQuota(100); // Search costs 100 quota units
      
      const response = await youtube.search.list({
        part: ['snippet'],
        q: query,
        type: ['video'],
        maxResults: maxResults,
        order: 'relevance'
      });

      return response.data.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnails: item.snippet.thumbnails,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle
      }));
    } catch (error) {
      console.error('YouTube Search Error:', error.message);
      throw new Error('Failed to search videos');
    }
  }

  async syncVideoToDatabase(videoId) {
    try {
      const videoDetails = await this.getVideoDetails(videoId);
      
      const { data, error } = await supabase
        .from('video_content')
        .upsert({
          youtube_video_id: videoDetails.id,
          title: videoDetails.title,
          description: videoDetails.description,
          thumbnail_url: videoDetails.thumbnails.high?.url || videoDetails.thumbnails.default?.url,
          duration: videoDetails.duration,
          published_date: videoDetails.publishedAt,
          view_count: videoDetails.viewCount,
          like_count: videoDetails.likeCount,
          category: 'ABACUS Learning', // Default category
          difficulty_level: 'beginner', // Default difficulty
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Database sync error:', error.message);
      throw new Error('Failed to sync video to database');
    }
  }

  getEmbedUrl(videoId) {
    return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&fs=1&cc_load_policy=1`;
  }

  getThumbnailUrl(videoId, quality = 'high') {
    const qualities = {
      default: `https://img.youtube.com/vi/${videoId}/default.jpg`,
      medium: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      high: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      standard: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
      maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    };

    return qualities[quality] || qualities.high;
  }

  parseDuration(duration) {
    // Parse ISO 8601 duration format (PT4M13S) to seconds
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    const hours = (match[1] || '0H').replace('H', '');
    const minutes = (match[2] || '0M').replace('M', '');
    const seconds = (match[3] || '0S').replace('S', '');
    
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
  }

  getQuotaUsed() {
    return apiQuotaUsed;
  }

  getQuotaRemaining() {
    return DAILY_QUOTA_LIMIT - apiQuotaUsed;
  }

  resetQuota() {
    apiQuotaUsed = 0;
    console.log('YouTube API quota reset');
  }
}

module.exports = new YouTubeService();