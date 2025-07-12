const { supabase } = require('../config/database');
const { formatSuccessResponse, formatErrorResponse, formatPaginationResponse } = require('../utils/responseUtils');

class ExerciseController {

  // ✅ 1. GET /api/exercises/categories - Get exercise categories
  static async getExerciseCategories(req, res) {
    try {
      const { data: categories, error } = await supabase
        .from('exercise_categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      res.json(formatSuccessResponse(categories, 'Exercise categories retrieved successfully'));

    } catch (error) {
      console.error('Get exercise categories error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise categories'
      });
    }
  }

  // ✅ 2. GET /api/exercises - Get all exercises with filtering
  static async getAllExercises(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        category_id, 
        difficulty_level, 
        problem_type,
        search 
      } = req.query;

      let query = supabase
        .from('exercises')
        .select(`
          id,
          category_id,
          problem_text,
          problem_type,
          operand1,
          operand2,
          operand3,
          operator,
          difficulty_level,
          max_time_seconds,
          points_value,
          hint_text,
          is_active,
          created_at,
          exercise_categories(name, difficulty_level)
        `)
        .eq('is_active', true);

      // Apply filters
      if (category_id) {
        query = query.eq('category_id', category_id);
      }

      if (difficulty_level) {
        query = query.eq('difficulty_level', difficulty_level);
      }

      if (problem_type) {
        query = query.eq('problem_type', problem_type);
      }

      if (search) {
        query = query.ilike('problem_text', `%${search}%`);
      }

      // Get total count for pagination
      const { data: countData, error: countError } = await supabase
        .from('exercises')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);

      if (countError) throw countError;

      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query
        .range(offset, offset + parseInt(limit) - 1)
        .order('created_at', { ascending: false });

      const { data: exercises, error } = await query;

      if (error) throw error;

      const formattedExercises = exercises.map(exercise => ({
        id: exercise.id,
        category_id: exercise.category_id,
        category_name: exercise.exercise_categories?.name || 'Unknown',
        problem_text: exercise.problem_text,
        problem_type: exercise.problem_type,
        difficulty_level: exercise.difficulty_level,
        max_time_seconds: exercise.max_time_seconds,
        points_value: exercise.points_value,
        has_hint: !!exercise.hint_text,
        created_at: exercise.created_at
      }));

      res.json(formatPaginationResponse(
        formattedExercises,
        page,
        limit,
        countData?.length || 0
      ));

    } catch (error) {
      console.error('Get all exercises error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercises'
      });
    }
  }

  // ✅ 3. POST /api/exercises - Create exercise (admin only)
  static async createExercise(req, res) {
    try {
      const {
        category_id,
        problem_text,
        problem_type,
        operand1,
        operand2,
        operand3,
        operator,
        correct_answer,
        difficulty_level = 'beginner',
        max_time_seconds = 60,
        points_value = 10,
        hint_text,
        explanation
      } = req.body;

      // Verify category exists
      const { data: category, error: categoryError } = await supabase
        .from('exercise_categories')
        .select('id')
        .eq('id', category_id)
        .eq('is_active', true)
        .single();

      if (categoryError || !category) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive category'
        });
      }

      const { data: exercise, error } = await supabase
        .from('exercises')
        .insert([{
          category_id,
          problem_text,
          problem_type,
          operand1: parseInt(operand1),
          operand2: operand2 ? parseInt(operand2) : null,
          operand3: operand3 ? parseInt(operand3) : null,
          operator,
          correct_answer: parseFloat(correct_answer),
          difficulty_level,
          max_time_seconds: parseInt(max_time_seconds),
          points_value: parseInt(points_value),
          hint_text,
          explanation,
          is_active: true
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json(formatSuccessResponse(exercise, 'Exercise created successfully'));

    } catch (error) {
      console.error('Create exercise error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create exercise'
      });
    }
  }

  // ✅ 4. GET /api/exercises/:id - Get exercise details
  static async getExerciseById(req, res) {
    try {
      const { id } = req.params;

      const { data: exercise, error } = await supabase
        .from('exercises')
        .select(`
          *,
          exercise_categories(name, description, difficulty_level)
        `)
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Exercise not found'
          });
        }
        throw error;
      }

      // Don't expose correct answer to students
      if (req.user.role === 'student') {
        delete exercise.correct_answer;
      }

      res.json(formatSuccessResponse(exercise, 'Exercise retrieved successfully'));

    } catch (error) {
      console.error('Get exercise by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise'
      });
    }
  }

  // ✅ 5. PUT /api/exercises/:id - Update exercise (admin only)
  static async updateExercise(req, res) {
    try {
      const { id } = req.params;
      const updateData = { ...req.body };
      
      // Remove fields that shouldn't be updated directly
      delete updateData.id;
      delete updateData.created_at;
      
      // Parse numeric fields
      if (updateData.operand1) updateData.operand1 = parseInt(updateData.operand1);
      if (updateData.operand2) updateData.operand2 = parseInt(updateData.operand2);
      if (updateData.operand3) updateData.operand3 = parseInt(updateData.operand3);
      if (updateData.correct_answer) updateData.correct_answer = parseFloat(updateData.correct_answer);
      if (updateData.max_time_seconds) updateData.max_time_seconds = parseInt(updateData.max_time_seconds);
      if (updateData.points_value) updateData.points_value = parseInt(updateData.points_value);

      updateData.updated_at = new Date().toISOString();

      const { data: exercise, error } = await supabase
        .from('exercises')
        .update(updateData)
        .eq('id', id)
        .eq('is_active', true)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Exercise not found'
          });
        }
        throw error;
      }

      res.json(formatSuccessResponse(exercise, 'Exercise updated successfully'));

    } catch (error) {
      console.error('Update exercise error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update exercise'
      });
    }
  }

  // ✅ 6. DELETE /api/exercises/:id - Delete exercise (admin only)
  static async deleteExercise(req, res) {
    try {
      const { id } = req.params;

      // Soft delete by setting is_active to false
      const { data: exercise, error } = await supabase
        .from('exercises')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('is_active', true)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Exercise not found'
          });
        }
        throw error;
      }

      res.json(formatSuccessResponse(null, 'Exercise deleted successfully'));

    } catch (error) {
      console.error('Delete exercise error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete exercise'
      });
    }
  }

  // ✅ 7. POST /api/exercises/:id/attempt - Submit exercise attempt (students)
  static async submitAttempt(req, res) {
    try {
      const { id } = req.params;
      const { 
        student_answer, 
        session_id, 
        time_taken_seconds = 0,
        hint_used = false 
      } = req.body;

      // Get exercise details
      const { data: exercise, error: exerciseError } = await supabase
        .from('exercises')
        .select('correct_answer, points_value')
        .eq('id', id)
        .eq('is_active', true)
        .single();

      if (exerciseError || !exercise) {
        return res.status(404).json({
          success: false,
          message: 'Exercise not found'
        });
      }

      // Check if answer is correct
      const isCorrect = parseFloat(student_answer) === parseFloat(exercise.correct_answer);
      const pointsEarned = isCorrect ? exercise.points_value : 0;

      // Create attempt record
      const { data: attempt, error } = await supabase
        .from('exercise_attempts')
        .insert([{
          session_id,
          exercise_id: id,
          student_answer: parseFloat(student_answer),
          is_correct: isCorrect,
          time_taken_seconds: parseInt(time_taken_seconds),
          hint_used,
          attempts_count: 1
        }])
        .select()
        .single();

      if (error) throw error;

      // Update session if provided
      if (session_id) {
        const { error: sessionError } = await supabase
          .from('exercise_sessions')
          .update({
            total_problems: supabase.raw('total_problems + 1'),
            correct_answers: isCorrect ? supabase.raw('correct_answers + 1') : supabase.raw('correct_answers'),
            incorrect_answers: !isCorrect ? supabase.raw('incorrect_answers + 1') : supabase.raw('incorrect_answers'),
            total_time_seconds: supabase.raw(`total_time_seconds + ${time_taken_seconds}`),
            score: supabase.raw(`score + ${pointsEarned}`)
          })
          .eq('id', session_id);

        if (sessionError) {
          console.error('Session update error:', sessionError);
        }
      }

      res.status(201).json(formatSuccessResponse({
        attempt_id: attempt.id,
        is_correct: isCorrect,
        points_earned: pointsEarned,
        correct_answer: exercise.correct_answer,
        time_taken: time_taken_seconds
      }, 'Exercise attempt submitted successfully'));

    } catch (error) {
      console.error('Submit attempt error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit attempt'
      });
    }
  }

  // ✅ 8. GET /api/exercises/:id/attempts - Get exercise attempts
  static async getExerciseAttempts(req, res) {
    try {
      const { id } = req.params;
      const { limit = 50 } = req.query;

      let query = supabase
        .from('exercise_attempts')
        .select(`
          id,
          student_answer,
          is_correct,
          time_taken_seconds,
          hint_used,
          attempts_count,
          created_at,
          exercise_sessions(student_id)
        `)
        .eq('exercise_id', id)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      // Students can only see their own attempts
      if (req.user.role === 'student') {
        // This would need student_id lookup from user
        // For now, we'll return empty for students accessing other exercises
        query = query.eq('session_id', 'never-match');
      }

      const { data: attempts, error } = await query;

      if (error) throw error;

      res.json(formatSuccessResponse(attempts, 'Exercise attempts retrieved successfully'));

    } catch (error) {
      console.error('Get exercise attempts error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise attempts'
      });
    }
  }

  // ✅ 9. GET /api/exercises/sessions/:studentId - Get exercise sessions
  static async getExerciseSessions(req, res) {
    try {
      const { studentId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      // Students can only access their own sessions
      if (req.user.role === 'student') {
        // TODO: Verify studentId belongs to requesting user
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { data: sessions, error } = await supabase
        .from('exercise_sessions')
        .select(`
          id,
          category_id,
          session_type,
          total_problems,
          correct_answers,
          incorrect_answers,
          total_time_seconds,
          accuracy_percentage,
          score,
          max_score,
          completed,
          started_at,
          completed_at,
          exercise_categories(name, difficulty_level)
        `)
        .eq('student_id', studentId)
        .order('started_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (error) throw error;

      // Calculate accuracy for each session
      const formattedSessions = sessions.map(session => ({
        ...session,
        accuracy_percentage: session.total_problems > 0 
          ? Math.round((session.correct_answers / session.total_problems) * 100)
          : 0
      }));

      res.json(formatSuccessResponse(formattedSessions, 'Exercise sessions retrieved successfully'));

    } catch (error) {
      console.error('Get exercise sessions error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch exercise sessions'
      });
    }
  }
}

module.exports = ExerciseController;