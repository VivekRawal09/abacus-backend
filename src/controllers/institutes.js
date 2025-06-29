const { supabase } = require('../config/database');

// GET /api/institutes - Get all institutes with pagination (FIXED PAGINATION)
const getAllInstitutes = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, zone_id, status } = req.query;

    let query = supabase
      .from('institutes')
      .select(`
        id, name, code, address, city, state, pincode,
        phone, email, established_date, status, created_at,
        zones(name, code)
      `, { count: 'exact' });

    // Apply filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,city.ilike.%${search}%`);
    }

    if (zone_id) {
      query = query.eq('zone_id', zone_id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: institutes, error, count } = await query
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // FIX: Match frontend pagination field names (camelCase)
    res.json({
      success: true,
      data: institutes,
      pagination: {
        currentPage: parseInt(page),        // FIXED: currentPage instead of current_page
        totalPages: Math.ceil(count / limit),
        totalItems: count,                  // FIXED: totalItems instead of total_items
        pageSize: parseInt(limit)           // FIXED: pageSize instead of items_per_page
      }
    });
  } catch (error) {
    console.error('Get institutes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// GET /api/institutes/:id - Get single institute by ID
const getInstituteById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: institute, error } = await supabase
      .from('institutes')
      .select(`
        *,
        zones(name, code),
        users(id, first_name, last_name, email, role)
      `)
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found'
      });
    }

    res.json({
      success: true,
      data: institute
    });
  } catch (error) {
    console.error('Get institute error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// POST /api/institutes - Create new institute (NEW - FIX FOR 404 ERROR)
// TEMPORARY DEBUG VERSION - Add this to your createInstitute function

const createInstitute = async (req, res) => {
  try {
    console.log('🔍 CREATE INSTITUTE DEBUG:');
    console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      name,
      code,
      address,
      city,
      state,
      pincode,
      phone,
      email,
      zone_id,
      established_date
    } = req.body;

    // LOG FIELD LENGTHS TO DEBUG
    console.log('📏 Field lengths:');
    console.log('- name:', name?.length || 0, '|', name);
    console.log('- code:', code?.length || 0, '|', code);
    console.log('- address:', address?.length || 0, '|', address);
    console.log('- city:', city?.length || 0, '|', city);
    console.log('- state:', state?.length || 0, '|', state);
    console.log('- phone:', phone?.length || 0, '|', phone);
    console.log('- email:', email?.length || 0, '|', email);

    // Validate required fields
    if (!name || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Name, city, and state are required'
      });
    }

    // Check if institute code already exists (if provided)
    if (code) {
      const { data: existingInstitute } = await supabase
        .from('institutes')
        .select('code')
        .eq('code', code)
        .single();

      if (existingInstitute) {
        return res.status(400).json({
          success: false,
          message: 'Institute code already exists'
        });
      }
    }

    // Create institute data
    const instituteData = {
      name,
      code,
      address,
      city,
      state,
      pincode,
      phone,
      email,
      zone_id: zone_id || null,
      established_date: established_date || null,
      status: 'active',
      created_at: new Date().toISOString()
    };

    console.log('💾 About to insert:', JSON.stringify(instituteData, null, 2));

    // Create institute
    const { data: newInstitute, error } = await supabase
      .from('institutes')
      .insert(instituteData)
      .select()
      .single();

    if (error) {
      console.error('❌ Database insert error:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error details:', error.details);
      console.error('❌ Error hint:', error.hint);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to create institute',
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
    }

    console.log('✅ Institute created successfully:', newInstitute);

    res.status(201).json({
      success: true,
      message: 'Institute created successfully',
      data: newInstitute
    });

  } catch (error) {
    console.error('❌ Create institute error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// PUT /api/institutes/:id - Update institute (NEW)
const updateInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      address,
      city,
      state,
      pincode,
      phone,
      email,
      zone_id,
      established_date,
      status
    } = req.body;

    // Check if institute exists
    const { data: existingInstitute, error: fetchError } = await supabase
      .from('institutes')
      .select('id, code')
      .eq('id', id)
      .single();

    if (fetchError || !existingInstitute) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found'
      });
    }

    // If code is being changed, check for duplicates
    if (code && code !== existingInstitute.code) {
      const { data: codeCheck } = await supabase
        .from('institutes')
        .select('code')
        .eq('code', code)
        .neq('id', id)
        .single();

      if (codeCheck) {
        return res.status(400).json({
          success: false,
          message: 'Institute code already exists'
        });
      }
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (pincode !== undefined) updateData.pincode = pincode;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (zone_id !== undefined) updateData.zone_id = zone_id;
    if (established_date !== undefined) updateData.established_date = established_date;
    if (status !== undefined) updateData.status = status;

    // Update institute
    const { data: updatedInstitute, error } = await supabase
      .from('institutes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update institute error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update institute'
      });
    }

    res.json({
      success: true,
      message: 'Institute updated successfully',
      data: updatedInstitute
    });

  } catch (error) {
    console.error('Update institute error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// DELETE /api/institutes/:id - Delete institute (NEW)
const deleteInstitute = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if institute exists
    const { data: existingInstitute, error: fetchError } = await supabase
      .from('institutes')
      .select('id, name')
      .eq('id', id)
      .single();

    if (fetchError || !existingInstitute) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found'
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from('institutes')
      .update({ 
        status: 'inactive',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      console.error('Delete institute error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete institute'
      });
    }

    res.json({
      success: true,
      message: 'Institute deleted successfully'
    });

  } catch (error) {
    console.error('Delete institute error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// PUT /api/institutes/:id/status - Toggle institute status (NEW)
const updateInstituteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const { data: updatedInstitute, error } = await supabase
      .from('institutes')
      .update({ 
        status: is_active ? 'active' : 'inactive',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Institute not found'
      });
    }

    res.json({
      success: true,
      message: `Institute ${is_active ? 'activated' : 'deactivated'} successfully`,
      data: updatedInstitute
    });

  } catch (error) {
    console.error('Update institute status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// DELETE /api/institutes/bulk - Bulk delete institutes (NEW)
const bulkDeleteInstitutes = async (req, res) => {
  try {
    const { instituteIds } = req.body;

    if (!instituteIds || !Array.isArray(instituteIds) || instituteIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Institute IDs array is required'
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from('institutes')
      .update({ 
        status: 'inactive',
        updated_at: new Date().toISOString()
      })
      .in('id', instituteIds);

    if (error) throw error;

    res.json({
      success: true,
      message: `${instituteIds.length} institutes deleted successfully`
    });

  } catch (error) {
    console.error('Bulk delete institutes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// GET /api/institutes/stats - Get institute statistics (EXISTING)
const getInstituteStats = async (req, res) => {
  try {
    // Get total institutes
    const { count: totalInstitutes, error: instituteError } = await supabase
      .from('institutes')
      .select('*', { count: 'exact', head: true });

    if (instituteError) throw instituteError;

    // Get institutes by status
    const { data: instituteStatusData, error: statusError } = await supabase
      .from('institutes')
      .select('status');

    if (statusError) throw statusError;

    const statusStats = instituteStatusData.reduce((acc, inst) => {
      acc[inst.status] = (acc[inst.status] || 0) + 1;
      return acc;
    }, {});

    // Get student count per institute (handle missing students table gracefully)
    let studentsByInstitute = {};
    try {
      const { data: studentCounts, error: studentError } = await supabase
        .from('users')  // Use users table instead of students
        .select('institute_id, institutes(name)')
        .eq('role', 'student');

      if (!studentError && studentCounts) {
        studentsByInstitute = studentCounts.reduce((acc, student) => {
          const instituteName = student.institutes?.name || 'Unknown';
          acc[instituteName] = (acc[instituteName] || 0) + 1;
          return acc;
        }, {});
      }
    } catch (studentError) {
      console.warn('Students data not available:', studentError.message);
      // Continue without student data
    }

    res.json({
      success: true,
      stats: {
        total_institutes: totalInstitutes,
        by_status: statusStats,
        students_by_institute: studentsByInstitute
      }
    });
  } catch (error) {
    console.error('Get institute stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getAllInstitutes,
  getInstituteById,
  getInstituteStats,
  createInstitute,         // NEW
  updateInstitute,         // NEW  
  deleteInstitute,         // NEW
  updateInstituteStatus,   // NEW
  bulkDeleteInstitutes     // NEW
};