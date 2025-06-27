const { supabase } = require('../config/database');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

// GET /api/users - Get all users with pagination (EXISTING - ENHANCED)
const getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      search, 
      status,
      institute_id 
    } = req.query;

    let query = supabase
      .from('users')
      .select(`
        id, first_name, last_name, email, role, phone,
        status, created_at, last_login, date_of_birth, gender,
        institute_id, zone_id,
        institutes(name),
        zones(name)
      `, { count: 'exact' });

    // Apply filters
    if (role) {
      query = query.eq('role', role);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (institute_id) {
      query = query.eq('institute_id', institute_id);
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: users, error, count } = await query
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Format response to match frontend expectations
    const formattedUsers = users.map(user => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      institute_name: user.institutes?.name || null,
      zone_name: user.zones?.name || null,
      is_active: user.status === 'active',
      last_login: user.last_login,
      created_at: user.created_at,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      institute_id: user.institute_id,
      zone_id: user.zone_id
    }));

    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        pageSize: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// GET /api/users/stats - Get user statistics (EXISTING)
const getUserStats = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('role, status');

    if (error) throw error;

    const statsByRole = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    const activeUsers = users.filter(u => u.status === 'active').length;

    res.json({
      success: true,
      stats: {
        total_users: users.length,
        active_users: activeUsers,
        by_role: statsByRole
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// GET /api/users/:id - Get single user by ID (NEW)
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id, first_name, last_name, email, role, phone,
        status, created_at, last_login, date_of_birth, gender, address,
        institute_id, zone_id,
        institutes(name),
        zones(name)
      `)
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Format response
    const formattedUser = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      institute_name: user.institutes?.name || null,
      zone_name: user.zones?.name || null,
      is_active: user.status === 'active',
      last_login: user.last_login,
      created_at: user.created_at,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      address: user.address,
      institute_id: user.institute_id,
      zone_id: user.zone_id
    };

    res.json({
      success: true,
      data: formattedUser
    });

  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// POST /api/users - Create new user (NEW)
const createUser = async (req, res) => {
  try {
    // Validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      first_name,
      last_name,
      email,
      password,
      role,
      phone,
      institute_id,
      zone_id,
      date_of_birth,
      gender,
      address
    } = req.body;

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Create user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        first_name,
        last_name,
        email,
        password_hash,
        role,
        phone,
        institute_id: institute_id || null,
        zone_id: zone_id || null,
        date_of_birth: date_of_birth || null,
        gender: gender || null,
        address: address || null,
        status: 'active',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Create user error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }

    // Remove password hash from response
    delete newUser.password_hash;

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: newUser
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// PUT /api/users/:id - Update user (NEW)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      role,
      phone,
      institute_id,
      zone_id,
      date_of_birth,
      gender,
      address,
      status
    } = req.body;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If email is being changed, check for duplicates
    if (email && email !== existingUser.email) {
      const { data: emailCheck } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .neq('id', id)
        .single();

      if (emailCheck) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone;
    if (institute_id !== undefined) updateData.institute_id = institute_id;
    if (zone_id !== undefined) updateData.zone_id = zone_id;
    if (date_of_birth !== undefined) updateData.date_of_birth = date_of_birth;
    if (gender !== undefined) updateData.gender = gender;
    if (address !== undefined) updateData.address = address;
    if (status !== undefined) updateData.status = status;

    // Update user
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update user error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user'
      });
    }

    // Remove password hash from response
    delete updatedUser.password_hash;

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// DELETE /api/users/:id - Delete user (NEW)
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deletion of super_admin users
    if (existingUser.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin users'
      });
    }

    // Soft delete - set status to inactive instead of hard delete
    const { error } = await supabase
      .from('users')
      .update({ 
        status: 'inactive',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      console.error('Delete user error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete user'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// PUT /api/users/:id/status - Toggle user status (NEW)
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const { data: updatedUser, error } = await supabase
      .from('users')
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
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
      data: updatedUser
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// DELETE /api/users/bulk - Bulk delete users (NEW)
const bulkDeleteUsers = async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    // Check for super_admin users in the list
    const { data: users, error: fetchError } = await supabase
      .from('users')
      .select('id, role')
      .in('id', userIds);

    if (fetchError) throw fetchError;

    const superAdmins = users.filter(u => u.role === 'super_admin');
    if (superAdmins.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin users'
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from('users')
      .update({ 
        status: 'inactive',
        updated_at: new Date().toISOString()
      })
      .in('id', userIds);

    if (error) throw error;

    res.json({
      success: true,
      message: `${userIds.length} users deleted successfully`
    });

  } catch (error) {
    console.error('Bulk delete users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// GET /api/users/export - Export users to CSV (NEW)
const exportUsers = async (req, res) => {
  try {
    const { role, status, institute_id } = req.query;

    let query = supabase
      .from('users')
      .select(`
        first_name, last_name, email, role, phone,
        status, created_at,
        institutes(name),
        zones(name)
      `);

    // Apply filters
    if (role) query = query.eq('role', role);
    if (status) query = query.eq('status', status);
    if (institute_id) query = query.eq('institute_id', institute_id);

    const { data: users, error } = await query
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Convert to CSV format
    const csvHeader = 'First Name,Last Name,Email,Role,Phone,Status,Institute,Zone,Created At\n';
    const csvData = users.map(user => 
      `"${user.first_name || ''}","${user.last_name || ''}","${user.email}","${user.role}","${user.phone || ''}","${user.status}","${user.institutes?.name || ''}","${user.zones?.name || ''}","${user.created_at}"`
    ).join('\n');

    const csv = csvHeader + csvData;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="users-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);

  } catch (error) {
    console.error('Export users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Validation middleware for user creation
const validateUserCreation = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['student', 'teacher', 'parent', 'institute_admin', 'zone_manager', 'super_admin']).withMessage('Valid role is required'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required'),
  body('institute_id').optional().isInt().withMessage('Valid institute ID required'),
  body('zone_id').optional().isInt().withMessage('Valid zone ID required')
];

module.exports = {
  getAllUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  bulkDeleteUsers,
  exportUsers,
  validateUserCreation
};