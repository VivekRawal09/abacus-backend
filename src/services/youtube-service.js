const { google } = require("googleapis");
const { supabase } = require("../config/database");

class YouTubeService {
  constructor() {
    this.youtube = google.youtube({
      version: "v3",
      auth: process.env.YOUTUBE_API_KEY,
    });
    this.quotaUsed = 0;
    this.quotaLimit = 10000; // Daily quota limit
  }

  // ENHANCED: Better error handling and fallback for missing API key
  async searchVideos(query, maxResults = 10) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      // Validate query
      if (!query || query.trim().length === 0) {
        throw new Error("Search query cannot be empty");
      }

      console.log(`🔍 Searching YouTube for: "${query}" (max: ${maxResults})`);

      const response = await this.youtube.search.list({
        part: "snippet",
        q: decodeURIComponent(query), // FIXED: Properly decode URL-encoded query
        type: "video",
        maxResults: parseInt(maxResults),
        order: "relevance",
        videoDefinition: "any",
        videoEmbeddable: "true",
        safeSearch: "strict",
      });

      this.quotaUsed += 100; // Search costs 100 quota units

      const videos = response.data.items.map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail:
          item.snippet.thumbnails?.maxresdefault?.url ||
          item.snippet.thumbnails?.high?.url ||
          item.snippet.thumbnails?.medium?.url,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        embedUrl: this.getEmbedUrl(item.id.videoId),
        thumbnailUrl: this.getThumbnailUrl(item.id.videoId),
      }));

      console.log(`✅ Found ${videos.length} videos for query: "${query}"`);
      return videos;
    } catch (error) {
      console.error("YouTube search error:", error);

      // ENHANCED: Better error messages
      if (error.code === 403) {
        throw new Error("YouTube API quota exceeded or invalid API key");
      } else if (error.code === 400) {
        throw new Error("Invalid search parameters");
      } else {
        throw new Error(`YouTube search failed: ${error.message}`);
      }
    }
  }

  // // ADDED: Mock search results for development/testing
  // getMockSearchResults(query, maxResults) {
  //   const mockVideos = [
  //     {
  //       videoId: "FTVXUG_PngE",
  //       title: `Abacus Tutorial: ${query} - Basic Function`,
  //       description: `Mock result for search: ${query}. This is a demonstration video.`,
  //       thumbnail: "https://i.ytimg.com/vi/FTVXUG_PngE/hqdefault.jpg",
  //       publishedAt: new Date().toISOString(),
  //       channelTitle: "ABACUS Learning Channel",
  //       channelId: "UC_mock_channel",
  //       embedUrl: this.getEmbedUrl("FTVXUG_PngE"),
  //       thumbnailUrl: this.getThumbnailUrl("FTVXUG_PngE"),
  //     },
  //     {
  //       videoId: "dQw4w9WgXcQ",
  //       title: `Advanced ${query} Techniques`,
  //       description: `Mock advanced tutorial for: ${query}`,
  //       thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  //       publishedAt: new Date().toISOString(),
  //       channelTitle: "Education Plus",
  //       channelId: "UC_mock_channel_2",
  //       embedUrl: this.getEmbedUrl("dQw4w9WgXcQ"),
  //       thumbnailUrl: this.getThumbnailUrl("dQw4w9WgXcQ"),
  //     },
  //   ];

  //   return mockVideos.slice(0, parseInt(maxResults));
  // }

  // Get video details by ID
  async getVideoDetails(videoId) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      const response = await this.youtube.videos.list({
        part: "snippet,contentDetails,statistics",
        id: videoId,
      });

      this.quotaUsed += 1; // Video details costs 1 quota unit

      if (!response.data.items || response.data.items.length === 0) {
        console.error(
          "❌ YouTube API returned no items for video ID:",
          videoId
        );
        console.log(
          "📋 YouTube API Response:",
          JSON.stringify(response.data, null, 2)
        );
        throw new Error("Video not found");
      }

      const video = response.data.items[0];

      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        thumbnail:
          video.snippet.thumbnails?.maxresdefault?.url ||
          video.snippet.thumbnails?.high?.url ||
          video.snippet.thumbnails?.medium?.url,
        duration: this.parseDuration(video.contentDetails.duration),
        publishedAt: video.snippet.publishedAt,
        channelTitle: video.snippet.channelTitle,
        channelId: video.snippet.channelId,
        viewCount: parseInt(video.statistics?.viewCount || 0),
        likeCount: parseInt(video.statistics?.likeCount || 0),
        tags: video.snippet.tags || [],
      };
    } catch (error) {
      console.error("Get video details error:", error);
      console.error("Error details:", {
        code: error.code,
        status: error.status,
        message: error.message,
        response: error.response?.data,
      });
      throw new Error(`Failed to get video details: ${error.message}`);
    }
  }

  // Sync video to database
  async syncVideoToDatabase(youtubeVideoId) {
    try {
      // Check if video already exists
      const { data: existingVideo, error: checkError } = await supabase
        .from("video_content")
        .select("id")
        .eq("youtube_video_id", youtubeVideoId)
        .single();

      if (existingVideo) {
        throw new Error("Video already exists in database");
      }

      // Get video details from YouTube
      const videoDetails = await this.getVideoDetails(youtubeVideoId);

      // Prepare data for database
      const videoData = {
        youtube_video_id: youtubeVideoId,
        title: videoDetails.title,
        description: videoDetails.description || "",
        duration: videoDetails.duration,
        view_count: videoDetails.viewCount,
        like_count: videoDetails.likeCount,
        channel_title: videoDetails.channelTitle || null,
        channel_id: videoDetails.channelId || null,
        published_date: videoDetails.publishedAt,
        tags: videoDetails.tags,
        category: "general", // Default category
        difficulty_level: "beginner", // Default difficulty
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Insert into database
      const { data: insertedVideo, error } = await supabase
        .from("video_content")
        .insert(videoData)
        .select()
        .single();

      if (error) {
        throw new Error(`Database insert failed: ${error.message}`);
      }

      return insertedVideo;
    } catch (error) {
      console.error("Sync video to database error:", error);
      throw error;
    }
  }

  // Get embed URL
  getEmbedUrl(youtubeVideoId) {
    return `https://www.youtube.com/embed/${youtubeVideoId}`;
  }

  // Get thumbnail URL
  getThumbnailUrl(youtubeVideoId, quality = "maxresdefault") {
    return `https://img.youtube.com/vi/${youtubeVideoId}/${quality}.jpg`;
  }

  // ENHANCED: Better duration parsing with error handling
  parseDuration(duration) {
    if (!duration) return 0;

    try {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;

      const hours = parseInt(match[1]) || 0;
      const minutes = parseInt(match[2]) || 0;
      const seconds = parseInt(match[3]) || 0;

      // Return total seconds
      return hours * 3600 + minutes * 60 + seconds;
    } catch (error) {
      console.error("Duration parse error:", error);
      return 0;
    }
  }

  // Format duration for display
  formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds === 0) return "0:00";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
    return this.quotaUsed + cost <= this.quotaLimit;
  }

  // Validate YouTube video ID format
  isValidVideoId(videoId) {
    const regex = /^[a-zA-Z0-9_-]{11}$/;
    return regex.test(videoId);
  }

  // Extract video ID from YouTube URL
  extractVideoId(url) {
    const regex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  // Batch import videos
  async batchImportVideos(videoIds) {
    const results = [];
    const errors = [];

    for (const videoId of videoIds) {
      try {
        if (!this.hasQuotaAvailable(101)) {
          // Search + details
          throw new Error("YouTube API quota exceeded");
        }

        const video = await this.syncVideoToDatabase(videoId);
        results.push(video);
      } catch (error) {
        errors.push({
          videoId,
          error: error.message,
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      quotaUsed: this.getQuotaUsed(),
      quotaRemaining: this.getQuotaRemaining(),
    };
  }

  // Get video categories from YouTube
  async getYouTubeCategories() {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      const response = await this.youtube.videoCategories.list({
        part: "snippet",
        regionCode: "US",
      });

      this.quotaUsed += 1;

      return response.data.items.map((item) => ({
        id: item.id,
        title: item.snippet.title,
      }));
    } catch (error) {
      console.error("Get YouTube categories error:", error);
      throw new Error(`Failed to get categories: ${error.message}`);
    }
  }

  // Search videos by category
  async searchByCategory(categoryId, maxResults = 10) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      const response = await this.youtube.search.list({
        part: "snippet",
        type: "video",
        videoCategoryId: categoryId,
        maxResults: maxResults,
        order: "relevance",
      });

      this.quotaUsed += 100;

      return response.data.items.map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.high?.url,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle,
      }));
    } catch (error) {
      console.error("Search by category error:", error);
      throw new Error(`Category search failed: ${error.message}`);
    }
  }

  // ADDED: Health check for YouTube API
  async healthCheck() {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        return {
          status: "warning",
          message: "YouTube API key not configured",
          quota: { used: 0, remaining: this.quotaLimit },
        };
      }

      // Simple API test
      await this.youtube.search.list({
        part: "snippet",
        q: "test",
        type: "video",
        maxResults: 1,
      });

      return {
        status: "healthy",
        message: "YouTube API is working",
        quota: { used: this.quotaUsed, remaining: this.getQuotaRemaining() },
      };
    } catch (error) {
      return {
        status: "error",
        message: `YouTube API error: ${error.message}`,
        quota: { used: this.quotaUsed, remaining: this.getQuotaRemaining() },
      };
    }
  }
}

// Export singleton instance
module.exports = new YouTubeService();
