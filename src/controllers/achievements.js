const { supabase } = require('../config/database');

class AchievementsController {

  // 1. GET /api/achievements - List all achievements
  static async getAllAchievements(req, res) {
    try {
      const { 
        category, 
        achievement_type, 
        rarity,
        is_active = true,
        page = 1, 
        limit = 20 
      } = req.query;

      const offset = (page - 1) * limit;

      let query = supabase
        .from('achievements')
        .select('*', { count: 'exact' });

      // Apply filters
      if (category) query = query.eq('category', category);
      if (achievement_type) query = query.eq('achievement_type', achievement_type);
      if (rarity) query = query.eq('rarity', rarity);
      if (is_active !== undefined) query = query.eq('is_active', is_active);

      const { data: achievements, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        success: true,
        data: {
          achievements: achievements || [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count || 0,
            pages: Math.ceil((count || 0) / limit)
          },
          filters: {
            categories: ['learning', 'progress', 'engagement', 'milestone'],
            types: ['completion', 'streak', 'performance', 'social'],
            rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary']
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get achievements error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch achievements'
      });
    }
  }

  // 2. POST /api/achievements - Create new achievement (admin only)
  static async createAchievement(req, res) {
    try {
      const {
        name,
        description,
        achievement_type,
        category = 'learning',
        icon_name = 'trophy',
        badge_color = '#FFD700',
        points_awarded = 50,
        criteria = {},
        rarity = 'common'
      } = req.body;

      // Validation
      if (!name || !description || !achievement_type) {
        return res.status(400).json({
          success: false,
          message: 'Name, description, and achievement type are required'
        });
      }

      if (name.length < 3 || description.length < 10) {
        return res.status(400).json({
          success: false,
          message: 'Name must be at least 3 characters, description at least 10 characters'
        });
      }

      // Validate achievement type and rarity
      const validTypes = ['completion', 'streak', 'performance', 'social', 'milestone'];
      const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

      if (!validTypes.includes(achievement_type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid achievement type. Must be one of: ${validTypes.join(', ')}`
        });
      }

      if (!validRarities.includes(rarity)) {
        return res.status(400).json({
          success: false,
          message: `Invalid rarity. Must be one of: ${validRarities.join(', ')}`
        });
      }

      // Create achievement
      const { data: achievement, error } = await supabase
        .from('achievements')
        .insert([{
          name: name.trim(),
          description: description.trim(),
          achievement_type,
          category,
          icon_name,
          badge_color,
          points_awarded: parseInt(points_awarded),
          criteria,
          rarity,
          is_active: true
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: achievement,
        message: 'Achievement created successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create achievement error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create achievement'
      });
    }
  }

  // 3. GET /api/achievements/:id - Get specific achievement details
  static async getAchievementById(req, res) {
    try {
      const { id } = req.params;

      const { data: achievement, error } = await supabase
        .from('achievements')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !achievement) {
        return res.status(404).json({
          success: false,
          message: 'Achievement not found'
        });
      }

      // Get statistics about this achievement
      const { data: stats } = await supabase
        .from('student_achievements')
        .select('id', { count: 'exact' })
        .eq('achievement_id', id);

      res.json({
        success: true,
        data: {
          ...achievement,
          statistics: {
            total_awarded: stats?.length || 0,
            last_awarded: null // Could add this with a more complex query
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get achievement by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch achievement details'
      });
    }
  }

  // 4. PUT /api/achievements/:id - Update achievement (admin only)
  static async updateAchievement(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        description,
        achievement_type,
        category,
        icon_name,
        badge_color,
        points_awarded,
        criteria,
        rarity,
        is_active
      } = req.body;

      // Check if achievement exists
      const { data: existingAchievement, error: fetchError } = await supabase
        .from('achievements')
        .select('id')
        .eq('id', id)
        .single();

      if (fetchError || !existingAchievement) {
        return res.status(404).json({
          success: false,
          message: 'Achievement not found'
        });
      }

      // Prepare update data
      const updateData = {};
      if (name) updateData.name = name.trim();
      if (description) updateData.description = description.trim();
      if (achievement_type) updateData.achievement_type = achievement_type;
      if (category) updateData.category = category;
      if (icon_name) updateData.icon_name = icon_name;
      if (badge_color) updateData.badge_color = badge_color;
      if (points_awarded !== undefined) updateData.points_awarded = parseInt(points_awarded);
      if (criteria) updateData.criteria = criteria;
      if (rarity) updateData.rarity = rarity;
      if (is_active !== undefined) updateData.is_active = is_active;

      // Update achievement
      const { data: updatedAchievement, error } = await supabase
        .from('achievements')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: updatedAchievement,
        message: 'Achievement updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Update achievement error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update achievement'
      });
    }
  }

  // 5. POST /api/achievements/:id/award - Award achievement to student
  static async awardAchievement(req, res) {
    try {
      const { id } = req.params;
      const { student_id, notes = '' } = req.body;

      if (!student_id) {
        return res.status(400).json({
          success: false,
          message: 'Student ID is required'
        });
      }

      // Check if achievement exists and is active
      const { data: achievement, error: achievementError } = await supabase
        .from('achievements')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (achievementError || !achievement) {
        return res.status(404).json({
          success: false,
          message: 'Achievement not found or inactive'
        });
      }

      // ✅ FIXED: Check if student exists (using users table)
      const { data: student, error: studentError } = await supabase
        .from('users')
        .select('id')
        .eq('id', student_id)
        .eq('role', 'student')
        .single();

      if (studentError || !student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }

      // Check if already awarded
      const { data: existingAward } = await supabase
        .from('student_achievements')
        .select('id')
        .eq('student_id', student_id)
        .eq('achievement_id', id)
        .single();

      if (existingAward) {
        return res.status(400).json({
          success: false,
          message: 'Achievement already awarded to this student'
        });
      }

      // Award achievement
      const { data: studentAchievement, error: awardError } = await supabase
        .from('student_achievements')
        .insert([{
          student_id,
          achievement_id: id,
          points_earned: achievement.points_awarded,
          metadata: {
            awarded_by: req.user.id,
            notes: notes.trim(),
            manual_award: true
          }
        }])
        .select()
        .single();

      if (awardError) throw awardError;

      // Update student points
      const { error: pointsError } = await supabase
        .from('student_points')
        .upsert({
          student_id,
          total_points: supabase.raw('total_points + ?', [achievement.points_awarded]),
          updated_at: new Date().toISOString()
        });

      if (pointsError) {
        console.error('Points update error:', pointsError);
        // Don't fail the achievement award if points update fails
      }

      res.status(201).json({
        success: true,
        data: {
          achievement_award: studentAchievement,
          achievement_details: {
            name: achievement.name,
            points_awarded: achievement.points_awarded,
            rarity: achievement.rarity
          }
        },
        message: 'Achievement awarded successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Award achievement error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to award achievement'
      });
    }
  }

  // 6. GET /api/gamification/leaderboard - Get points leaderboard
  static async getLeaderboard(req, res) {
    try {
      const { 
        timeframe = 'all', // all, week, month, year
        institute_id,
        limit = 20,
        student_id // To get specific student's rank
      } = req.query;

      // ✅ FIXED: Updated query to use users table directly
      let query = supabase
        .from('student_points')
        .select(`
          student_id, total_points, weekly_points, monthly_points, yearly_points,
          current_streak_days, level_number,
          users:student_id(first_name, last_name, institute_id)
        `);

      // Apply institute filter if provided (now using users.institute_id)
      if (institute_id) {
        query = query.eq('users.institute_id', institute_id);
      }

      // Choose points field based on timeframe
      let orderField = 'total_points';
      if (timeframe === 'week') orderField = 'weekly_points';
      else if (timeframe === 'month') orderField = 'monthly_points';
      else if (timeframe === 'year') orderField = 'yearly_points';

      const { data: leaderboard, error } = await query
        .order(orderField, { ascending: false })
        .limit(limit);

      if (error) throw error;

      // ✅ FIXED: Format leaderboard data with updated user reference
      const formattedLeaderboard = (leaderboard || []).map((entry, index) => ({
        rank: index + 1,
        student_id: entry.student_id,
        name: entry.users ? `${entry.users.first_name} ${entry.users.last_name}`.trim() : 'Unknown',
        institute_id: entry.users?.institute_id,
        points: entry[orderField] || 0,
        total_points: entry.total_points,
        current_streak: entry.current_streak_days,
        level: entry.level_number
      }));

      // Get specific student's rank if requested
      let studentRank = null;
      if (student_id) {
        const studentEntry = formattedLeaderboard.find(entry => entry.student_id === student_id);
        studentRank = studentEntry ? studentEntry.rank : null;
      }

      res.json({
        success: true,
        data: {
          leaderboard: formattedLeaderboard,
          timeframe,
          total_participants: formattedLeaderboard.length,
          student_rank: studentRank,
          last_updated: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get leaderboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch leaderboard'
      });
    }
  }

  // 7. POST /api/gamification/points - Award points to student
  static async awardPoints(req, res) {
    try {
      const {
        student_id,
        points,
        reason,
        source_type = 'manual',
        source_id = null
      } = req.body;

      // Validation
      if (!student_id || !points) {
        return res.status(400).json({
          success: false,
          message: 'Student ID and points are required'
        });
      }

      if (points <= 0 || points > 1000) {
        return res.status(400).json({
          success: false,
          message: 'Points must be between 1 and 1000'
        });
      }

      // ✅ FIXED: Check if student exists (using users table)
      const { data: student, error: studentError } = await supabase
        .from('users')
        .select('id')
        .eq('id', student_id)
        .eq('role', 'student')
        .single();

      if (studentError || !student) {
        return res.status(404).json({
          success: false,
          message: 'Student not found'
        });
      }

      // Update student points
      const { data: updatedPoints, error: pointsError } = await supabase
        .from('student_points')
        .upsert({
          student_id,
          total_points: supabase.raw('total_points + ?', [points]),
          weekly_points: supabase.raw('weekly_points + ?', [points]),
          monthly_points: supabase.raw('monthly_points + ?', [points]),
          yearly_points: supabase.raw('yearly_points + ?', [points]),
          last_activity_date: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (pointsError) throw pointsError;

      // Log the point award in activity logs
      await supabase
        .from('activity_logs')
        .insert([{
          user_id: req.user.id,
          action: 'points_awarded',
          entity_type: 'student',
          entity_id: student_id,
          details: {
            points_awarded: points,
            reason: reason || 'Manual points award',
            source_type,
            source_id,
            awarded_by: req.user.id
          }
        }]);

      res.status(201).json({
        success: true,
        data: {
          student_id,
          points_awarded: points,
          new_total_points: updatedPoints.total_points,
          reason: reason || 'Manual points award'
        },
        message: 'Points awarded successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Award points error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to award points'
      });
    }
  }
}

module.exports = AchievementsController;