// HIGHLY OPTIMIZED YouTube Service - Performance Enhanced Version
// Replace src/services/youtube-service.js with this optimized version

const { google } = require("googleapis");
const { supabase } = require("../config/database");

class OptimizedYouTubeService {
  constructor() {
    this.youtube = google.youtube({
      version: "v3",
      auth: process.env.YOUTUBE_API_KEY,
    });
    this.quotaUsed = 0;
    this.quotaLimit = 10000;
    
    // PERFORMANCE BOOST: Add intelligent caching for API responses
    this.cache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes cache
    
    // PERFORMANCE BOOST: Track API health and prevent unnecessary calls
    this.lastHealthCheck = null;
    this.isHealthy = true;
    this.failureCount = 0;
    this.circuitBreaker = false;
  }

  /**
   * PERFORMANCE BOOST: Intelligent cache management
   */
  getCacheKey(operation, params) {
    return `${operation}:${JSON.stringify(params)}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key); // Remove expired cache
    return null;
  }

  setCache(key, data) {
    // PERFORMANCE BOOST: Prevent memory leaks with cache size limit
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * PERFORMANCE BOOST: Circuit breaker pattern for API failures
   */
  async executeWithCircuitBreaker(operation) {
    if (this.circuitBreaker) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure < 60000) { // 1 minute cooldown
        throw new Error("Circuit breaker active - YouTube API temporarily unavailable");
      } else {
        this.circuitBreaker = false;
        this.failureCount = 0;
      }
    }

    try {
      const result = await operation();
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      if (this.failureCount >= 3) {
        this.circuitBreaker = true;
        this.lastFailureTime = Date.now();
      }
      throw error;
    }
  }

  /**
   * PERFORMANCE BOOST: Optimized search with caching and better error handling
   */
  async searchVideos(query, maxResults = 10) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      if (!query || query.trim().length === 0) {
        throw new Error("Search query cannot be empty");
      }

      // PERFORMANCE BOOST: Check cache first - saves API calls
      const cacheKey = this.getCacheKey('search', { query, maxResults });
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log(`📋 Cache HIT: Using cached search results for: "${query}"`);
        return cached;
      }

      // PERFORMANCE BOOST: Check quota before making expensive API calls
      if (!this.hasQuotaAvailable(100)) {
        throw new Error("YouTube API quota exceeded for today");
      }

      console.log(`🔍 Cache MISS: Searching YouTube for: "${query}" (max: ${maxResults})`);

      const result = await this.executeWithCircuitBreaker(async () => {
        const response = await this.youtube.search.list({
          part: "snippet",
          q: decodeURIComponent(query.trim()),
          type: "video",
          maxResults: parseInt(maxResults),
          order: "relevance",
          videoDefinition: "any",
          videoEmbeddable: "true",
          safeSearch: "strict",
          regionCode: "US", // PERFORMANCE BOOST: Better/faster results
          fields: "items(id/videoId,snippet(title,description,thumbnails,publishedAt,channelTitle,channelId))" // PERFORMANCE BOOST: Only fetch needed fields
        });

        this.quotaUsed += 100;

        const videos = response.data.items.map((item) => ({
          videoId: item.id.videoId,
          title: this.sanitizeTitle(item.snippet.title),
          description: this.truncateDescription(item.snippet.description),
          thumbnail: this.getBestThumbnail(item.snippet.thumbnails),
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          channelId: item.snippet.channelId,
          embedUrl: this.getEmbedUrl(item.id.videoId),
          thumbnailUrl: this.getThumbnailUrl(item.id.videoId),
        }));

        return videos;
      });

      // PERFORMANCE BOOST: Cache successful results for future requests
      this.setCache(cacheKey, result);

      console.log(`✅ Found ${result.length} videos for query: "${query}"`);
      return result;

    } catch (error) {
      console.error("YouTube search error:", error);
      this.handleAPIError(error);
      throw this.formatAPIError(error);
    }
  }

  /**
   * PERFORMANCE BOOST: Optimized video details with caching
   */
  async getVideoDetails(videoId) {
    try {
      if (!process.env.YOUTUBE_API_KEY) {
        throw new Error("YouTube API key not configured");
      }

      // PERFORMANCE BOOST: Check cache first
      const cacheKey = this.getCacheKey('details', { videoId });
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log(`📋 Cache HIT: Using cached video details for: ${videoId}`);
        return cached;
      }

      if (!this.hasQuotaAvailable(1)) {
        throw new Error("YouTube API quota exceeded");
      }

      const result = await this.executeWithCircuitBreaker(async () => {
        const response = await this.youtube.videos.list({
          part: "snippet,contentDetails,statistics",
          id: videoId,
          fields: "items(id,snippet(title,description,thumbnails,publishedAt,channelTitle,channelId,tags),contentDetails/duration,statistics(viewCount,likeCount))" // PERFORMANCE BOOST: Only needed fields
        });

        this.quotaUsed += 1;

        if (!response.data.items || response.data.items.length === 0) {
          throw new Error("Video not found on YouTube");
        }

        const video = response.data.items[0];
        return {
          id: video.id,
          title: this.sanitizeTitle(video.snippet.title),
          description: video.snippet.description || "",
          thumbnail: this.getBestThumbnail(video.snippet.thumbnails),
          duration: this.parseDuration(video.contentDetails.duration),
          publishedAt: video.snippet.publishedAt,
          channelTitle: video.snippet.channelTitle,
          channelId: video.snippet.channelId,
          viewCount: parseInt(video.statistics?.viewCount || 0),
          likeCount: parseInt(video.statistics?.likeCount || 0),
          tags: video.snippet.tags || [],
        };
      });

      // PERFORMANCE BOOST: Cache successful results
      this.setCache(cacheKey, result);

      return result;

    } catch (error) {
      console.error("Get video details error:", error);
      this.handleAPIError(error);
      throw this.formatAPIError(error);
    }
  }

  /**
   * PERFORMANCE BOOST: Optimized sync with duplicate prevention and batch processing
   */
  async syncVideoToDatabase(youtubeVideoId) {
    try {
      // PERFORMANCE BOOST: Quick duplicate check using database index
      const { data: existingVideo } = await supabase
        .from("video_content")
        .select("id")
        .eq("youtube_video_id", youtubeVideoId)
        .maybeSingle(); // PERFORMANCE BOOST: Use maybeSingle instead of single

      if (existingVideo) {
        throw new Error("Video already exists in database");
      }

      // Get video details (with caching)
      const videoDetails = await this.getVideoDetails(youtubeVideoId);

      // PERFORMANCE BOOST: Prepare data with validation and prevent overflow
      const videoData = {
        youtube_video_id: youtubeVideoId,
        title: videoDetails.title.substring(0, 255), // Prevent DB overflow
        description: videoDetails.description.substring(0, 1000), // Limit description
        duration: videoDetails.duration,
        view_count: videoDetails.viewCount,
        like_count: videoDetails.likeCount,
        channel_title: videoDetails.channelTitle?.substring(0, 100),
        channel_id: videoDetails.channelId,
        published_date: videoDetails.publishedAt,
        tags: Array.isArray(videoDetails.tags) ? videoDetails.tags.slice(0, 20) : [], // Limit tags
        category: "general",
        difficulty_level: "beginner",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

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

  /**
   * PERFORMANCE BOOST: Optimized utility functions
   */
  sanitizeTitle(title) {
    if (!title) return 'Untitled Video';
    return title.replace(/[<>]/g, '').trim();
  }

  truncateDescription(description) {
    if (!description) return '';
    return description.length > 500 ? description.substring(0, 497) + '...' : description;
  }

  getBestThumbnail(thumbnails) {
    if (!thumbnails) return null;
    return thumbnails.maxresdefault?.url ||
           thumbnails.high?.url ||
           thumbnails.medium?.url ||
           thumbnails.default?.url ||
           null;
  }

  /**
   * PERFORMANCE BOOST: Enhanced error handling with circuit breaker
   */
  handleAPIError(error) {
    if (error.code === 403) {
      this.isHealthy = false;
      this.failureCount++;
    }
  }

  formatAPIError(error) {
    if (error.code === 403) {
      return new Error("YouTube API quota exceeded or invalid API key");
    } else if (error.code === 400) {
      return new Error("Invalid YouTube API request parameters");
    } else if (error.code === 404) {
      return new Error("YouTube video not found");
    } else {
      return new Error(`YouTube API error: ${error.message}`);
    }
  }

  /**
   * PERFORMANCE BOOST: Enhanced duration parsing with error handling
   */
  parseDuration(duration) {
    if (!duration) return 0;

    try {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;

      const hours = parseInt(match[1]) || 0;
      const minutes = parseInt(match[2]) || 0;
      const seconds = parseInt(match[3]) || 0;

      return hours * 3600 + minutes * 60 + seconds;
    } catch (error) {
      console.error("Duration parse error:", error);
      return 0;
    }
  }

  /**
   * PERFORMANCE BOOST: Static methods (no need to access instance variables)
   */
  getEmbedUrl(youtubeVideoId) {
    return `https://www.youtube.com/embed/${youtubeVideoId}?rel=0&modestbranding=1&autoplay=0`;
  }

  getThumbnailUrl(youtubeVideoId, quality = "maxresdefault") {
    return `https://img.youtube.com/vi/${youtubeVideoId}/${quality}.jpg`;
  }

  formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds === 0) return "0:00";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  getQuotaUsed() {
    return this.quotaUsed;
  }

  getQuotaRemaining() {
    return this.quotaLimit - this.quotaUsed;
  }

  hasQuotaAvailable(cost = 1) {
    return this.quotaUsed + cost <= this.quotaLimit;
  }

  resetQuota() {
    this.quotaUsed = 0;
    this.isHealthy = true;
    this.failureCount = 0;
    this.circuitBreaker = false;
  }

  /**
   * PERFORMANCE BOOST: Health check with caching and circuit breaker
   */
  async healthCheck() {
    try {
      // PERFORMANCE BOOST: Cache health check for 5 minutes
      if (this.lastHealthCheck && Date.now() - this.lastHealthCheck < 5 * 60 * 1000) {
        return {
          status: this.isHealthy ? "healthy" : "degraded",
          message: this.isHealthy ? "YouTube API is working (cached)" : "YouTube API issues detected",
          quota: { used: this.quotaUsed, remaining: this.getQuotaRemaining() },
          cached: true,
          circuitBreaker: this.circuitBreaker
        };
      }

      if (!process.env.YOUTUBE_API_KEY) {
        return {
          status: "warning",
          message: "YouTube API key not configured",
          quota: { used: 0, remaining: this.quotaLimit },
        };
      }

      // Simple API test with circuit breaker
      await this.executeWithCircuitBreaker(async () => {
        await this.youtube.search.list({
          part: "snippet",
          q: "test",
          type: "video",
          maxResults: 1,
          fields: "items(id)" // PERFORMANCE BOOST: Minimal fields for health check
        });
      });

      this.isHealthy = true;
      this.lastHealthCheck = Date.now();

      return {
        status: "healthy",
        message: "YouTube API is working",
        quota: { used: this.quotaUsed, remaining: this.getQuotaRemaining() },
        circuitBreaker: this.circuitBreaker
      };

    } catch (error) {
      this.isHealthy = false;
      this.lastHealthCheck = Date.now();

      return {
        status: "error",
        message: `YouTube API error: ${error.message}`,
        quota: { used: this.quotaUsed, remaining: this.getQuotaRemaining() },
        circuitBreaker: this.circuitBreaker
      };
    }
  }

  /**
   * PERFORMANCE BOOST: Optimized batch operations with concurrency control
   */
  async batchImportVideos(videoIds, concurrency = 3) {
    const results = [];
    const errors = [];
    
    // PERFORMANCE BOOST: Process in controlled batches to prevent API rate limits
    for (let i = 0; i < videoIds.length; i += concurrency) {
      const batch = videoIds.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (videoId) => {
        try {
          if (!this.hasQuotaAvailable(101)) {
            throw new Error("YouTube API quota exceeded");
          }

          const video = await this.syncVideoToDatabase(videoId);
          return { success: true, video, videoId };
        } catch (error) {
          return { success: false, error: error.message, videoId };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        const videoId = batch[index];
        if (result.status === 'fulfilled' && result.value.success) {
          results.push(result.value.video);
        } else {
          const errorMessage = result.status === 'rejected' 
            ? result.reason.message 
            : result.value.error;
          errors.push({ videoId, error: errorMessage });
        }
      });

      // PERFORMANCE BOOST: Small delay between batches to prevent rate limiting
      if (i + concurrency < videoIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      successful: results,
      failed: errors,
      quotaUsed: this.getQuotaUsed(),
      quotaRemaining: this.getQuotaRemaining(),
    };
  }

  /**
   * PERFORMANCE BOOST: Cache management
   */
  clearCache() {
    this.cache.clear();
    console.log("YouTube service cache cleared");
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: 1000,
      hitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
    };
  }

  /**
   * PERFORMANCE BOOST: Validate YouTube video ID format before API calls
   */
  isValidVideoId(videoId) {
    const regex = /^[a-zA-Z0-9_-]{11}$/;
    return regex.test(videoId);
  }

  /**
   * PERFORMANCE BOOST: Extract video ID from YouTube URL before processing
   */
  extractVideoId(url) {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }
}

// Export singleton instance
module.exports = new OptimizedYouTubeService();