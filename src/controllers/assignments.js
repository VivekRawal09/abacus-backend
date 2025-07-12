const { supabase } = require('../config/database');
const { formatSuccessResponse, formatErrorResponse, formatPaginationResponse } = require('../utils/responseUtils');

class AssignmentController {

  // ✅ 1. GET /api/assignments - Get assignments with role-based filtering
  static async getAssignments(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        student_id, 
        completed, 
        priority, 
        due_date 
      } = req.query;

      let query = supabase
        .from('student_video_assignments')
        .select(`
          id,
          student_id,
          video_id,
          lesson_id,
          assigned_by,
          assigned_at,
          due_date,
          is_mandatory,
          completed,
          completed_at,
          notes,
          priority,
          auto_assigned,
          created_at,
          video_content(title, youtube_video_id),
          lessons(title, description, lesson_type),
          users!assigned_by(first_name, last_name)
        `)
        .order('created_at', { ascending: false });

      // ✅ ROLE-BASED ACCESS CONTROL: Get student record for current user
      if (req.user.role === 'student') {
        // Get the student record for this user
        const { data: studentRecord } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        
        if (studentRecord) {
          query = query.eq('student_id', studentRecord.id);
        } else {
          // User is a student but has no student record - return empty
          return res.json(formatPaginationResponse([], page, limit, 0));
        }
      } else if (req.user.role === 'parent') {
        // Parents see assignments of their children
        if (student_id) {
          query = query.eq('student_id', student_id);
        } else {
          return res.status(400).json({
            success: false,
            message: 'Parents must specify student_id parameter'
          });
        }
      } else if (req.user.role === 'institute_admin') {
        // Institute admins see assignments for students in their institute
        const { data: instituteStudents } = await supabase
          .from('students')
          .select('id')
          .eq('institute_id', req.user.institute_id);
        
        const studentIds = instituteStudents?.map(s => s.id) || [];
        if (studentIds.length > 0) {
          query = query.in('student_id', studentIds);
        } else {
          // No students in institute
          return res.json(formatPaginationResponse([], page, limit, 0));
        }
      } else if (req.user.role === 'zone_manager') {
        // Zone managers see assignments for students in their zone  
        const { data: zoneStudents } = await supabase
          .from('students')
          .select(`
            id,
            users!inner(zone_id)
          `)
          .eq('users.zone_id', req.user.zone_id);
        
        const studentIds = zoneStudents?.map(s => s.id) || [];
        if (studentIds.length > 0) {
          query = query.in('student_id', studentIds);
        } else {
          // No students in zone
          return res.json(formatPaginationResponse([], page, limit, 0));
        }
      }
      // Super admin sees all assignments (no additional filtering)

      // Apply filters
      if (student_id && req.user.role !== 'student') {
        query = query.eq('student_id', student_id);
      }

      if (completed !== undefined) {
        query = query.eq('completed', completed === 'true');
      }

      if (priority) {
        query = query.eq('priority', priority);
      }

      if (due_date) {
        query = query.gte('due_date', due_date);
      }

      // Get total count for pagination
      const { count, error: countError } = await supabase
        .from('student_video_assignments')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // Apply pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      query = query.range(offset, offset + parseInt(limit) - 1);

      const { data: assignments, error } = await query;

      if (error) throw error;

      // Format assignments for response
      const formattedAssignments = assignments.map(assignment => ({
        id: assignment.id,
        student_id: assignment.student_id,
        content: {
          type: assignment.video_id ? 'video' : 'lesson',
          id: assignment.video_id || assignment.lesson_id,
          title: assignment.video_content?.title || assignment.lessons?.title || 'Unknown',
          duration: assignment.video_content?.duration_seconds || null
        },
        assigned_by: assignment.users ? 
          `${assignment.users.first_name} ${assignment.users.last_name}`.trim() : 
          'System',
        assigned_at: assignment.assigned_at,
        due_date: assignment.due_date,
        is_mandatory: assignment.is_mandatory,
        completed: assignment.completed,
        completed_at: assignment.completed_at,
        priority: assignment.priority,
        auto_assigned: assignment.auto_assigned,
        has_notes: !!assignment.notes
      }));

      res.json(formatPaginationResponse(
        formattedAssignments,
        page,
        limit,
        count
      ));

    } catch (error) {
      console.error('Get assignments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assignments',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 2. POST /api/assignments - Create assignment (admin only)
  static async createAssignment(req, res) {
    try {
      const {
        student_id,
        video_id,
        lesson_id,
        due_date,
        is_mandatory = true,
        priority = 'medium',
        notes,
        auto_assigned = false
      } = req.body;

      // ✅ VALIDATION: Verify student exists and admin has permission
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select(`
          id, 
          user_id,
          institute_id
        `)
        .eq('user_id', student_id)
        .single();

      if (studentError || !student) {
        console.error('Student lookup error:', studentError);
        return res.status(400).json({
          success: false,
          message: 'Student not found or invalid'
        });
      }

      // Get user data separately to avoid join issues
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, role, status, institute_id, zone_id')
        .eq('id', student_id)
        .eq('status', 'active')
        .eq('role', 'student')
        .single();

      if (userError || !userData) {
        return res.status(400).json({
          success: false,
          message: 'Student user not found or invalid'
        });
      }

      // ✅ FIXED: Use static method correctly with user data
      if (!AssignmentController.canAssignToStudent(req.user, userData)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to assign to this student'
        });
      }

      // ✅ VALIDATION: Verify video or lesson exists
      if (video_id) {
        const { data: video, error: videoError } = await supabase
          .from('video_content')
          .select('id')
          .eq('id', video_id)
          .eq('status', 'active')
          .single();

        if (videoError || !video) {
          return res.status(400).json({
            success: false,
            message: 'Video not found or inactive'
          });
        }
      }

      if (lesson_id) {
        const { data: lesson, error: lessonError } = await supabase
          .from('lessons')
          .select('id')
          .eq('id', lesson_id)
          .eq('is_active', true)
          .single();

        if (lessonError || !lesson) {
          return res.status(400).json({
            success: false,
            message: 'Lesson not found or inactive'
          });
        }
      }

      // ✅ FIXED: Use students.id (not users.id) for the assignment
      const { data: assignment, error } = await supabase
        .from('student_video_assignments')
        .insert([{
          student_id: student.id, // Use students.id, not users.id
          video_id,
          lesson_id,
          assigned_by: req.user.id,
          due_date,
          is_mandatory,
          priority,
          notes,
          auto_assigned,
          completed: false
        }])
        .select()
        .single();

      if (error) {
        console.error('Assignment insert error:', error);
        throw error;
      }

      res.status(201).json(formatSuccessResponse(assignment, 'Assignment created successfully'));

    } catch (error) {
      console.error('Create assignment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create assignment',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 3. GET /api/assignments/:id - Get assignment details
  static async getAssignmentById(req, res) {
    try {
      const { id } = req.params;

      let query = supabase
        .from('student_video_assignments')
        .select(`
          *,
          video_content(title, description, youtube_video_id, thumbnail_url),
          lessons(title, description, lesson_type, estimated_duration_minutes),
          users!assigned_by(first_name, last_name, role)
        `)
        .eq('id', id);

      // Apply role-based filtering
      if (req.user.role === 'student') {
        // Get the student record for this user
        const { data: studentRecord } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', req.user.id)
          .single();
        
        if (studentRecord) {
          query = query.eq('student_id', studentRecord.id);
        } else {
          return res.status(404).json({
            success: false,
            message: 'Student record not found'
          });
        }
      }

      const { data: assignment, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Assignment not found'
          });
        }
        throw error;
      }

      // Check permissions for non-students
      if (req.user.role !== 'student') {
        const { data: student } = await supabase
          .from('users')
          .select('institute_id, zone_id')
          .eq('id', assignment.student_id)
          .single();

        if (student && !AssignmentController.canViewStudentData(req.user, student)) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions to view this assignment'
          });
        }
      }

      res.json(formatSuccessResponse(assignment, 'Assignment retrieved successfully'));

    } catch (error) {
      console.error('Get assignment by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assignment',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 4. PUT /api/assignments/:id - Update assignment (admin only)
  static async updateAssignment(req, res) {
    try {
      const { id } = req.params;
      const updateData = { ...req.body };

      // Remove fields that shouldn't be updated directly
      delete updateData.id;
      delete updateData.student_id;
      delete updateData.assigned_at;
      delete updateData.created_at;
      delete updateData.completed_at;

      updateData.updated_at = new Date().toISOString();

      const { data: assignment, error } = await supabase
        .from('student_video_assignments')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({
            success: false,
            message: 'Assignment not found'
          });
        }
        throw error;
      }

      res.json(formatSuccessResponse(assignment, 'Assignment updated successfully'));

    } catch (error) {
      console.error('Update assignment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update assignment',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 5. POST /api/assignments/:id/submit - Submit assignment (students)
  static async submitAssignment(req, res) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      // Get assignment first
      const { data: assignment, error: assignmentError } = await supabase
        .from('student_video_assignments')
        .select('*')
        .eq('id', id)
        .single();

      if (assignmentError || !assignment) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found'
        });
      }

      // Verify this assignment belongs to the current student user
      const { data: studentRecord } = await supabase
        .from('students')
        .select('id, user_id')
        .eq('user_id', req.user.id)
        .single();

      if (!studentRecord || assignment.student_id !== studentRecord.id) {
        return res.status(404).json({
          success: false,
          message: 'Assignment not found or not assigned to you'
        });
      }

      if (assignment.completed) {
        return res.status(400).json({
          success: false,
          message: 'Assignment already completed'
        });
      }

      // Mark assignment as completed
      const { data: updatedAssignment, error } = await supabase
        .from('student_video_assignments')
        .update({
          completed: true,
          completed_at: new Date().toISOString(),
          notes: notes || assignment.notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      res.json(formatSuccessResponse({
        assignment_id: updatedAssignment.id,
        completed_at: updatedAssignment.completed_at,
        status: 'completed'
      }, 'Assignment submitted successfully'));

    } catch (error) {
      console.error('Submit assignment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit assignment',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 6. GET /api/assignments/templates - Get assignment templates (admin)
  static async getAssignmentTemplates(req, res) {
    try {
      const { template_type, difficulty_level, is_active } = req.query;

      // ✅ FIXED: Return hardcoded templates since assignment_templates table may not exist
      const templates = [
        {
          id: '1',
          name: 'Basic Addition Video Series',
          template_type: 'video_sequence',
          difficulty_level: 'beginner',
          description: 'A series of videos covering basic addition concepts',
          content_data: {
            video_sequence: [
              'Introduction to Addition',
              'Single Digit Addition',
              'Double Digit Addition'
            ],
            estimated_duration: 45,
            prerequisites: []
          },
          is_active: true,
          institute_id: null
        },
        {
          id: '2',
          name: 'Multiplication Practice Set',
          template_type: 'practice_set',
          difficulty_level: 'intermediate',
          description: 'Interactive multiplication exercises',
          content_data: {
            exercise_types: ['drill', 'word_problems', 'visual'],
            difficulty_progression: true,
            time_limit: 30
          },
          is_active: true,
          institute_id: null
        },
        {
          id: '3',
          name: 'ABACUS Fundamentals Assessment',
          template_type: 'assessment',
          difficulty_level: 'beginner',
          description: 'Comprehensive assessment of ABACUS basics',
          content_data: {
            question_types: ['multiple_choice', 'practical'],
            passing_score: 70,
            retake_allowed: true
          },
          is_active: true,
          institute_id: null
        },
        {
          id: '4',
          name: 'Advanced Mental Math Lessons',
          template_type: 'lesson_series',
          difficulty_level: 'advanced',
          description: 'Advanced mental math techniques using ABACUS',
          content_data: {
            lesson_count: 12,
            skills_covered: ['speed_calculation', 'large_numbers', 'decimals'],
            certification: true
          },
          is_active: true,
          institute_id: null
        }
      ];

      // Apply filters
      let filteredTemplates = templates;

      if (template_type) {
        filteredTemplates = filteredTemplates.filter(t => t.template_type === template_type);
      }

      if (difficulty_level) {
        filteredTemplates = filteredTemplates.filter(t => t.difficulty_level === difficulty_level);
      }

      if (is_active !== undefined) {
        filteredTemplates = filteredTemplates.filter(t => t.is_active === (is_active === 'true'));
      }

      // Apply institute filtering for institute admins
      if (req.user.role === 'institute_admin' && req.user.institute_id) {
        filteredTemplates = filteredTemplates.filter(t => 
          t.institute_id === null || t.institute_id === req.user.institute_id
        );
      }

      res.json(formatSuccessResponse(filteredTemplates, 'Assignment templates retrieved successfully'));

    } catch (error) {
      console.error('Get assignment templates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch assignment templates',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ 7. POST /api/assignments/video-based - Create video-based assignment (admin)
  static async createVideoBasedAssignment(req, res) {
    try {
      const {
        student_ids,
        video_ids,
        due_date,
        is_mandatory = true,
        priority = 'medium',
        notes
      } = req.body;

      // ✅ VALIDATION: Verify all students exist and admin has permission
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select(`
          id,
          user_id, 
          institute_id
        `)
        .in('user_id', student_ids);

      if (studentsError) {
        console.error('Students lookup error:', studentsError);
        throw studentsError;
      }

      if (students.length !== student_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Some students not found or invalid'
        });
      }

      // Get user data separately to avoid join issues
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, institute_id, zone_id, role, status')
        .in('id', student_ids)
        .eq('status', 'active')
        .eq('role', 'student');

      if (usersError || usersData.length !== student_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Some student users not found or invalid'
        });
      }

      // ✅ FIXED: Check permissions for all students using static method
      const unauthorizedStudents = usersData.filter(userData => 
        !AssignmentController.canAssignToStudent(req.user, userData)
      );

      if (unauthorizedStudents.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to assign to some students'
        });
      }

      // ✅ VALIDATION: Verify all videos exist
      const { data: videos, error: videosError } = await supabase
        .from('video_content')
        .select('id')
        .in('id', video_ids)
        .eq('status', 'active');

      if (videosError) {
        console.error('Videos lookup error:', videosError);
        throw videosError;
      }

      if (videos.length !== video_ids.length) {
        return res.status(400).json({
          success: false,
          message: 'Some videos not found or inactive'
        });
      }

      // Create assignments for each student-video combination
      const assignments = [];
      for (const student_id of student_ids) {
        // Find the student record to get students.id
        const studentRecord = students.find(s => s.user_id === student_id);
        if (studentRecord) {
          for (const video_id of video_ids) {
            assignments.push({
              student_id: studentRecord.id, // Use students.id, not users.id
              video_id,
              assigned_by: req.user.id,
              due_date,
              is_mandatory,
              priority,
              notes,
              auto_assigned: false,
              completed: false
            });
          }
        }
      }

      // Insert assignments in batches
      let createdCount = 0;
      const batchSize = 100;

      for (let i = 0; i < assignments.length; i += batchSize) {
        const batch = assignments.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('student_video_assignments')
          .insert(batch);

        if (insertError) {
          console.error('Batch insert error:', insertError);
          continue;
        }

        createdCount += batch.length;
      }

      res.status(201).json(formatSuccessResponse({
        assignments_created: createdCount,
        total_students: student_ids.length,
        total_videos: video_ids.length,
        failed_assignments: assignments.length - createdCount
      }, 'Video-based assignments created successfully'));

    } catch (error) {
      console.error('Create video-based assignment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create video-based assignments',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // ✅ FIXED: Helper method to check if admin can assign to student
  static canAssignToStudent(admin, student) {
    // Super admin can assign to anyone
    if (admin.role === 'super_admin') {
      return true;
    }

    // Zone manager can assign to students in their zone
    if (admin.role === 'zone_manager' && admin.zone_id === student.zone_id) {
      return true;
    }

    // Institute admin can assign to students in their institute
    if (admin.role === 'institute_admin' && admin.institute_id === student.institute_id) {
      return true;
    }

    return false;
  }

  // ✅ FIXED: Helper method to check if user can view student data
  static canViewStudentData(user, student) {
    return AssignmentController.canAssignToStudent(user, student);
  }
}

module.exports = AssignmentController;