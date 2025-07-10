const { supabase } = require('../config/database');

class AssessmentsController {

  // 1. GET /api/assessments - Get all assessments
  static async getAllAssessments(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        difficulty_level, 
        status = 'active',
        search 
      } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('assessments')
        .select(`
          *,
          video_content:video_id(title, duration)
        `);

      // Apply filters
      if (difficulty_level) query = query.eq('difficulty_level', difficulty_level);
      if (status) query = query.eq('status', status);
      if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
      }

      const { data: assessments, error } = await query
        .range(offset, offset + parseInt(limit) - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get total count
      const { count: totalCount } = await supabase
        .from('assessments')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

      res.json({
        success: true,
        data: {
          assessments: assessments || [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil((totalCount || 0) / limit),
            totalAssessments: totalCount || 0,
            hasNextPage: (totalCount || 0) > offset + limit,
            limit: parseInt(limit)
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assessments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assessments'
      });
    }
  }

  // 2. POST /api/assessments - Create assessment (admin only)
  static async createAssessment(req, res) {
    try {
      const {
        title,
        description,
        video_id,
        questions = [],
        total_marks,
        passing_marks,
        time_limit,
        difficulty_level = 'beginner'
      } = req.body;

      // Validation
      if (!title || !questions || questions.length === 0 || !total_marks || !passing_marks) {
        return res.status(400).json({
          success: false,
          message: 'Title, questions, total_marks, and passing_marks are required'
        });
      }

      // Create assessment
      const { data: assessment, error } = await supabase
        .from('assessments')
        .insert([{
          title,
          description,
          video_id,
          questions,
          total_marks,
          passing_marks,
          time_limit,
          difficulty_level,
          status: 'active'
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: assessment,
        message: 'Assessment created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Create assessment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create assessment'
      });
    }
  }

  // 3. GET /api/assessments/:id - Get assessment details
  static async getAssessmentById(req, res) {
    try {
      const { id } = req.params;

      const { data: assessment, error } = await supabase
        .from('assessments')
        .select(`
          *,
          video_content:video_id(title, duration, thumbnail_url)
        `)
        .eq('id', id)
        .eq('status', 'active')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Assessment not found'
          });
        }
        throw error;
      }

      // For students, hide correct answers
      if (req.user.role === 'student') {
        if (assessment.questions && Array.isArray(assessment.questions)) {
          assessment.questions = assessment.questions.map(q => {
            const { correct_answer, ...questionWithoutAnswer } = q;
            return questionWithoutAnswer;
          });
        }
      }

      res.json({
        success: true,
        data: assessment,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assessment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assessment'
      });
    }
  }

  // 4. PUT /api/assessments/:id - Update assessment (admin only)
  static async updateAssessment(req, res) {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        video_id,
        questions,
        total_marks,
        passing_marks,
        time_limit,
        difficulty_level,
        status
      } = req.body;

      // Check if assessment exists
      const { data: existingAssessment, error: checkError } = await supabase
        .from('assessments')
        .select('id')
        .eq('id', id)
        .single();

      if (checkError || !existingAssessment) {
        return res.status(404).json({
          success: false,
          message: 'Assessment not found'
        });
      }

      // Build update object
      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (video_id !== undefined) updateData.video_id = video_id;
      if (questions !== undefined) updateData.questions = questions;
      if (total_marks !== undefined) updateData.total_marks = total_marks;
      if (passing_marks !== undefined) updateData.passing_marks = passing_marks;
      if (time_limit !== undefined) updateData.time_limit = time_limit;
      if (difficulty_level !== undefined) updateData.difficulty_level = difficulty_level;
      if (status !== undefined) updateData.status = status;

      // Update assessment
      const { data: assessment, error } = await supabase
        .from('assessments')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data: assessment,
        message: 'Assessment updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Update assessment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update assessment'
      });
    }
  }

  // 5. DELETE /api/assessments/:id - Delete assessment (admin only)
  static async deleteAssessment(req, res) {
    try {
      const { id } = req.params;

      // Check if assessment exists
      const { data: existingAssessment, error: checkError } = await supabase
        .from('assessments')
        .select('id, title')
        .eq('id', id)
        .single();

      if (checkError || !existingAssessment) {
        return res.status(404).json({
          success: false,
          message: 'Assessment not found'
        });
      }

      // Soft delete (set status to inactive)
      const { error } = await supabase
        .from('assessments')
        .update({ 
          status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      res.json({
        success: true,
        message: 'Assessment deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Delete assessment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete assessment'
      });
    }
  }

  // 6. POST /api/assessments/:id/submit - Submit assessment (students)
  static async submitAssessment(req, res) {
    try {
      const { id } = req.params;
      const { answers, time_taken } = req.body;

      if (!answers || typeof answers !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'Answers object is required'
        });
      }

      // Get assessment details
      const { data: assessment, error: assessmentError } = await supabase
        .from('assessments')
        .select('*')
        .eq('id', id)
        .eq('status', 'active')
        .single();

      if (assessmentError || !assessment) {
        return res.status(404).json({
          success: false,
          message: 'Assessment not found'
        });
      }

      // Get student ID
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('id')
        .eq('user_id', req.user.id)
        .single();

      if (studentError || !student) {
        return res.status(403).json({
          success: false,
          message: 'Student access required'
        });
      }

      // Calculate score
      let score = 0;
      const questions = assessment.questions || [];
      
      questions.forEach((question, index) => {
        const userAnswer = answers[index] || answers[question.id];
        if (userAnswer === question.correct_answer) {
          score += question.points || 1;
        }
      });

      const percentage = assessment.total_marks > 0 
        ? (score / assessment.total_marks * 100).toFixed(2) 
        : 0;
      const passed = score >= assessment.passing_marks;

      // Get attempt number
      const { data: existingAttempts } = await supabase
        .from('student_assessments')
        .select('attempt_number')
        .eq('student_id', student.id)
        .eq('assessment_id', id)
        .order('attempt_number', { ascending: false })
        .limit(1);

      const attemptNumber = existingAttempts && existingAttempts.length > 0 
        ? existingAttempts[0].attempt_number + 1 
        : 1;

      // Save submission
      const { data: submission, error } = await supabase
        .from('student_assessments')
        .insert([{
          student_id: student.id,
          assessment_id: id,
          answers,
          score,
          total_marks: assessment.total_marks,
          percentage: parseFloat(percentage),
          passed,
          time_taken: time_taken || 0,
          attempt_number: attemptNumber,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        success: true,
        data: {
          submission_id: submission.id,
          score,
          total_marks: assessment.total_marks,
          percentage: parseFloat(percentage),
          passed,
          attempt_number: attemptNumber,
          time_taken: time_taken || 0
        },
        message: 'Assessment submitted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Submit assessment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit assessment'
      });
    }
  }

  // 7. GET /api/assessments/:id/results - Get assessment results
  static async getAssessmentResults(req, res) {
    try {
      const { id } = req.params;
      const { student_id } = req.query;

      // Check access permissions
      let targetStudentId = student_id;
      if (req.user.role === 'student') {
        // Students can only see their own results
        const { data: student } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        
        if (!student) {
          return res.status(403).json({
            success: false,
            message: 'Student access required'
          });
        }
        targetStudentId = student.id;
      }

      let query = supabase
        .from('student_assessments')
        .select(`
          *,
          students:student_id(
            student_id,
            users:user_id(first_name, last_name)
          )
        `)
        .eq('assessment_id', id);

      if (targetStudentId) {
        query = query.eq('student_id', targetStudentId);
      }

      const { data: results, error } = await query
        .order('completed_at', { ascending: false });

      if (error) throw error;

      res.json({
        success: true,
        data: {
          assessment_id: id,
          results: results || [],
          total_submissions: results?.length || 0,
          average_score: results && results.length > 0 
            ? (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(2)
            : 0,
          pass_rate: results && results.length > 0
            ? ((results.filter(r => r.passed).length / results.length) * 100).toFixed(1)
            : 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assessment results error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assessment results'
      });
    }
  }

  // 8. GET /api/assessments/:id/analytics - Assessment analytics (admin)
  static async getAssessmentAnalytics(req, res) {
    try {
      const { id } = req.params;

      // Get assessment details
      const { data: assessment, error: assessmentError } = await supabase
        .from('assessments')
        .select('title, total_marks, passing_marks')
        .eq('id', id)
        .single();

      if (assessmentError || !assessment) {
        return res.status(404).json({
          success: false,
          message: 'Assessment not found'
        });
      }

      // Get all submissions
      const { data: submissions, error } = await supabase
        .from('student_assessments')
        .select('score, percentage, passed, time_taken, completed_at')
        .eq('assessment_id', id);

      if (error) throw error;

      const totalSubmissions = submissions?.length || 0;
      const passedSubmissions = submissions?.filter(s => s.passed).length || 0;
      const avgScore = totalSubmissions > 0 
        ? (submissions.reduce((sum, s) => sum + s.score, 0) / totalSubmissions).toFixed(2)
        : 0;
      const avgTime = totalSubmissions > 0 
        ? (submissions.reduce((sum, s) => sum + (s.time_taken || 0), 0) / totalSubmissions).toFixed(1)
        : 0;

      // Score distribution
      const scoreRanges = {
        '90-100': 0,
        '80-89': 0,
        '70-79': 0,
        '60-69': 0,
        '0-59': 0
      };

      submissions?.forEach(s => {
        const percentage = s.percentage || 0;
        if (percentage >= 90) scoreRanges['90-100']++;
        else if (percentage >= 80) scoreRanges['80-89']++;
        else if (percentage >= 70) scoreRanges['70-79']++;
        else if (percentage >= 60) scoreRanges['60-69']++;
        else scoreRanges['0-59']++;
      });

      res.json({
        success: true,
        data: {
          assessment_info: {
            title: assessment.title,
            total_marks: assessment.total_marks,
            passing_marks: assessment.passing_marks
          },
          summary: {
            total_submissions: totalSubmissions,
            passed_submissions: passedSubmissions,
            pass_rate: totalSubmissions > 0 ? ((passedSubmissions / totalSubmissions) * 100).toFixed(1) : 0,
            average_score: avgScore,
            average_time_minutes: avgTime
          },
          score_distribution: scoreRanges,
          recent_submissions: submissions?.slice(0, 10) || []
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get assessment analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assessment analytics'
      });
    }
  }
}

module.exports = AssessmentsController;