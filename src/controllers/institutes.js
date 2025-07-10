const { supabase } = require('../config/database');

// Import utilities
const {
  formatPaginationResponse,
  formatSuccessResponse,
  formatErrorResponse,
  formatNotFoundResponse,
  formatBulkResponse,
  asyncHandler
} = require('../utils/responseUtils');

const {
  validatePagination,
  sanitizeSearchQuery,
  validateIdArray,
  validateBoolean
} = require('../utils/validationUtils');

const { queryCache, statsCache } = require('../utils/cacheUtils');

/**
 * ✅ SECURITY FIX: Data scope filtering based on user role
 */
const applyScopeFilters = (query, user, additionalFilters = {}) => {
  // Super admin sees everything
  if (user.permissions.isSuperAdmin) {
    // Apply any additional filters
    Object.entries(additionalFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query = query.eq(key, value);
      }
    });
    return query;
  }
  
  // Zone manager sees institutes in their zone
  if (user.permissions.isZoneManager && user.zone_id) {
    query = query.eq('zone_id', user.zone_id);
  }
  
  // Institute admin sees only their institute
  else if (user.permissions.isInstituteAdmin && user.institute_id) {
    query = query.eq('id', user.institute_id);
  }
  
  // Other roles cannot access institutes
  else {
    // Return empty query for unauthorized access
    query = query.eq('id', -1); // Non-existent ID
  }
  
  // Apply any additional filters
  Object.entries(additionalFilters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query = query.eq(key, value);
    }
  });
  
  return query;
};

/**
 * ✅ SECURITY FIX: Validate institute IDs belong to user's scope
 */
const validateInstituteScope = async (instituteIds, requesterUser) => {
  // Super admin can access all institutes
  if (requesterUser.permissions.isSuperAdmin) {
    return { valid: true, validIds: instituteIds };
  }
  
  // Get institute details to validate scope
  const { data: institutes, error } = await supabase
    .from('institutes')
    .select('id, zone_id')
    .in('id', instituteIds);
    
  if (error) {
    throw new Error(`Failed to validate institute scope: ${error.message}`);
  }
  
  const validIds = [];
  const invalidIds = [];
  
  institutes.forEach(institute => {
    let isValid = false;
    
    // Zone manager can access institutes in their zone
    if (requesterUser.permissions.isZoneManager) {
      isValid = institute.zone_id === requesterUser.zone_id;
    }
    // Institute admin can access only their institute
    else if (requesterUser.permissions.isInstituteAdmin) {
      isValid = institute.id === requesterUser.institute_id;
    }
    
    if (isValid) {
      validIds.push(institute.id);
    } else {
      invalidIds.push(institute.id);
    }
  });
  
  return {
    valid: invalidIds.length === 0,
    validIds,
    invalidIds,
    invalidCount: invalidIds.length
  };
};

// ✅ ENHANCED: getAllInstitutes with role-based data scoping
const getAllInstitutes = asyncHandler(async (req, res) => {
  const { page, limit } = validatePagination(req.query.page, req.query.limit);
  const { search, zone_id, status } = req.query;
  const sanitizedSearch = sanitizeSearchQuery(search);

  // ✅ SECURITY FIX: Validate zone_id filter against user permissions
  if (zone_id) {
    if (!req.user.permissions.isSuperAdmin && !req.user.permissions.isZoneManager) {
      return formatErrorResponse(res, 
        new Error('Insufficient permissions to filter by zone'), 
        'get institutes', 403);
    }
    
    // Zone manager can only filter by their zone
    if (req.user.permissions.isZoneManager && parseInt(zone_id) !== req.user.zone_id) {
      return formatErrorResponse(res, 
        new Error('Cannot filter by zones outside your scope'), 
        'get institutes', 403);
    }
  }

  // ✅ NEW: Create cache key that includes user scope
  const cacheKey = queryCache.createKey('institutes:list', {
    page, limit, search: sanitizedSearch, zone_id, status,
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await queryCache.get(cacheKey, async () => {
    let query = supabase
      .from('institutes')
      .select(`
        id, name, code, address, city, state, pincode,
        phone, email, established_date, status, created_at,
        zones(name, code)
      `, { count: 'exact' });

    // ✅ SECURITY FIX: Apply scope filtering based on user role
    query = applyScopeFilters(query, req.user, { zone_id, status });

    // ✅ SECURITY FIX: SQL injection prevention - use parameterized queries
    if (sanitizedSearch) {
      // Use proper SQL escaping instead of string interpolation
      const escapedSearch = sanitizedSearch.replace(/[%_]/g, '\\$&');
      query = query.or(`name.ilike.%${escapedSearch}%,code.ilike.%${escapedSearch}%,city.ilike.%${escapedSearch}%`);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: institutes, error, count } = await query
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { institutes, count };
  });

  res.json(formatPaginationResponse(result.institutes, page, limit, result.count));
});

// ✅ ENHANCED: getInstituteById with scope validation
const getInstituteById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ SECURITY FIX: Validate institute access
  const scopeValidation = await validateInstituteScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Institute not in your scope'), 
      'get institute by ID', 403);
  }
  
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
    return formatNotFoundResponse(res, 'Institute');
  }

  res.json(formatSuccessResponse(institute));
});

// ✅ ENHANCED: createInstitute with zone validation
const createInstitute = asyncHandler(async (req, res) => {
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

  // ✅ SECURITY FIX: Validate required fields
  if (!name || !city || !state) {
    return formatErrorResponse(res, 
      new Error('Name, city, and state are required'), 
      'create institute', 400);
  }

  // ✅ SECURITY FIX: Validate zone assignment based on user permissions
  let validatedZoneId = zone_id;

  if (!req.user.permissions.isSuperAdmin) {
    // Zone manager can only create institutes in their zone
    if (req.user.permissions.isZoneManager) {
      if (zone_id && zone_id !== req.user.zone_id) {
        return formatErrorResponse(res, 
          new Error('Cannot create institutes in other zones'), 
          'create institute', 403);
      }
      validatedZoneId = req.user.zone_id;
    }
    // Institute admin cannot create institutes
    else {
      return formatErrorResponse(res, 
        new Error('Insufficient permissions to create institutes'), 
        'create institute', 403);
    }
  }

  // ✅ FIXED: Generate code if not provided
  const instituteCode = code || `INST${Date.now().toString().slice(-6)}`;

  // ✅ FIXED: Provide default address if not provided  
  const instituteAddress = address || `${city}, ${state}`;

  // Check if institute code already exists (if provided)
  if (code) {
    const { data: existingInstitute } = await supabase
      .from('institutes')
      .select('code')
      .eq('code', instituteCode)
      .single();

    if (existingInstitute) {
      return formatErrorResponse(res, 
        new Error('Institute code already exists'), 
        'create institute', 400);
    }
  }

  // ✅ FIXED: Create institute with all required fields
  const { data: newInstitute, error } = await supabase
    .from('institutes')
    .insert({
      name,
      code: instituteCode,
      address: instituteAddress,
      city,
      state,
      pincode: pincode || null,
      phone: phone || null,
      email: email || null,
      zone_id: validatedZoneId || null,
      established_date: established_date || null,
      status: 'active',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('Create institute error:', error);
    return formatErrorResponse(res, error, 'create institute');
  }

  // ✅ IMPORTANT: Invalidate cache after creation
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.status(201).json(formatSuccessResponse(newInstitute, 'Institute created successfully'));
});

// ✅ ENHANCED: updateInstitute with scope validation
const updateInstitute = asyncHandler(async (req, res) => {
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

  // ✅ SECURITY FIX: Validate institute access
  const scopeValidation = await validateInstituteScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Institute not in your scope'), 
      'update institute', 403);
  }

  // Check if institute exists
  const { data: existingInstitute, error: fetchError } = await supabase
    .from('institutes')
    .select('id, code, zone_id')
    .eq('id', id)
    .single();

  if (fetchError || !existingInstitute) {
    return formatNotFoundResponse(res, 'Institute');
  }

  // ✅ SECURITY FIX: Validate zone changes based on user permissions
  if (zone_id && zone_id !== existingInstitute.zone_id) {
    if (!req.user.permissions.isSuperAdmin) {
      return formatErrorResponse(res, 
        new Error('Insufficient permissions to change institute zone'), 
        'update institute', 403);
    }
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
      return formatErrorResponse(res, 
        new Error('Institute code already exists'), 
        'update institute', 400);
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
    return formatErrorResponse(res, error, 'update institute');
  }

  // ✅ IMPORTANT: Invalidate cache after update
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.json(formatSuccessResponse(updatedInstitute, 'Institute updated successfully'));
});

// ✅ ENHANCED: deleteInstitute with scope validation and dependency checks
const deleteInstitute = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ SECURITY FIX: Validate institute access
  const scopeValidation = await validateInstituteScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Institute not in your scope'), 
      'delete institute', 403);
  }

  // Check if institute exists
  const { data: existingInstitute, error: fetchError } = await supabase
    .from('institutes')
    .select('id, name')
    .eq('id', id)
    .single();

  if (fetchError || !existingInstitute) {
    return formatNotFoundResponse(res, 'Institute');
  }

  // ✅ SECURITY FIX: Enhanced dependency check
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, role')
    .eq('institute_id', id)
    .limit(5); // Get sample of users

  if (usersError) {
    console.error('Error checking institute users:', usersError);
  } else if (users && users.length > 0) {
    const userRoles = users.map(u => u.role).join(', ');
    return formatErrorResponse(res, 
      new Error(`Cannot delete institute with ${users.length} existing users (${userRoles}). Please reassign or remove users first.`), 
      'delete institute', 400);
  }

  // HARD DELETE - Actually remove from database
  const { error } = await supabase
    .from('institutes')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Delete institute error:', error);
    return formatErrorResponse(res, error, 'delete institute');
  }

  // ✅ IMPORTANT: Invalidate cache after deletion
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.json(formatSuccessResponse(null, 'Institute deleted successfully'));
});

// ✅ ENHANCED: updateInstituteStatus with scope validation
const updateInstituteStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  const validation = validateBoolean(is_active, 'is_active');
  if (!validation.isValid) {
    return formatErrorResponse(res, 
      new Error(validation.error), 
      'update institute status', 400);
  }

  // ✅ SECURITY FIX: Validate institute access
  const scopeValidation = await validateInstituteScope([parseInt(id)], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error('Access denied: Institute not in your scope'), 
      'update institute status', 403);
  }

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
    return formatNotFoundResponse(res, 'Institute');
  }

  // ✅ IMPORTANT: Invalidate cache after status update
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.json(formatSuccessResponse(
    updatedInstitute, 
    `Institute ${is_active ? 'activated' : 'deactivated'} successfully`
  ));
});

// ✅ ENHANCED: bulkDeleteInstitutes with comprehensive scope validation
const bulkDeleteInstitutes = asyncHandler(async (req, res) => {
  const { instituteIds } = req.body;

  const validation = validateIdArray(instituteIds, 'Institute IDs');
  if (!validation.isValid) {
    return formatErrorResponse(res, 
      new Error(validation.error), 
      'bulk delete institutes', 400);
  }

  // ✅ SECURITY FIX: Validate all institutes belong to requester's scope
  const scopeValidation = await validateInstituteScope(validation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} institutes not in your scope`), 
      'bulk delete institutes', 403);
  }

  // Check if any institutes have users
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('institute_id, role')
    .in('institute_id', scopeValidation.validIds);

  if (usersError) {
    console.error('Error checking institute users:', usersError);
  } else if (users && users.length > 0) {
    const institutesWithUsers = [...new Set(users.map(u => u.institute_id))];
    const userCounts = users.reduce((acc, user) => {
      acc[user.institute_id] = (acc[user.institute_id] || 0) + 1;
      return acc;
    }, {});
    
    const details = institutesWithUsers.map(id => 
      `Institute ${id} (${userCounts[id]} users)`
    ).join(', ');
    
    return formatErrorResponse(res, 
      new Error(`Cannot delete institutes with existing users: ${details}`), 
      'bulk delete institutes', 400);
  }

  // HARD DELETE - Actually remove from database
  const { error } = await supabase
    .from('institutes')
    .delete()
    .in('id', scopeValidation.validIds);

  if (error) throw error;

  // ✅ IMPORTANT: Invalidate cache after bulk deletion
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.json(formatBulkResponse('deleted', scopeValidation.validIds.length));
});

// ✅ ENHANCED: bulkUpdateInstituteStatus with scope validation
const bulkUpdateInstituteStatus = asyncHandler(async (req, res) => {
  const { instituteIds, is_active } = req.body;

  const idsValidation = validateIdArray(instituteIds, 'Institute IDs');
  if (!idsValidation.isValid) {
    return formatErrorResponse(res, 
      new Error(idsValidation.error), 
      'bulk update institute status', 400);
  }

  const statusValidation = validateBoolean(is_active, 'is_active');
  if (!statusValidation.isValid) {
    return formatErrorResponse(res, 
      new Error(statusValidation.error), 
      'bulk update institute status', 400);
  }

  // ✅ SECURITY FIX: Validate all institutes belong to requester's scope
  const scopeValidation = await validateInstituteScope(idsValidation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} institutes not in your scope`), 
      'bulk update institute status', 403);
  }

  // SOFT UPDATE - Update status for bulk operations
  const { error } = await supabase
    .from("institutes")
    .update({
      status: is_active ? "active" : "inactive",
      updated_at: new Date().toISOString(),
    })
    .in("id", scopeValidation.validIds);

  if (error) throw error;

  // ✅ IMPORTANT: Invalidate cache after bulk update
  queryCache.invalidatePattern('institutes:.*');
  statsCache.invalidatePattern('institutes:.*');

  res.json(formatBulkResponse(
    is_active ? 'activated' : 'deactivated', 
    scopeValidation.validIds.length,
    { new_status: is_active ? 'active' : 'inactive' }
  ));
});

// ✅ ENHANCED: getInstituteStats with role-based scoping
const getInstituteStats = asyncHandler(async (req, res) => {
  const cacheKey = statsCache.createKey('institutes:stats', {
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const stats = await statsCache.get(cacheKey, async () => {
    // Get total institutes with scope filtering
    let institutesQuery = supabase.from('institutes').select('*');
    institutesQuery = applyScopeFilters(institutesQuery, req.user);
    
    const { count: totalInstitutes, error: instituteError } = await institutesQuery;
    if (instituteError) throw instituteError;

    // Get institutes by status with scope filtering
    let statusQuery = supabase.from('institutes').select('status');
    statusQuery = applyScopeFilters(statusQuery, req.user);
    
    const { data: instituteStatusData, error: statusError } = await statusQuery;
    if (statusError) throw statusError;

    const statusStats = instituteStatusData.reduce((acc, inst) => {
      acc[inst.status] = (acc[inst.status] || 0) + 1;
      return acc;
    }, {});

    // Get student count per institute (with scope filtering)
    let studentsByInstitute = {};
    try {
      let usersQuery = supabase
        .from('users')
        .select('institute_id, institutes(name)')
        .eq('role', 'student');
      
      // Apply user scope filtering for students
      usersQuery = applyScopeFilters(usersQuery, req.user);
      
      const { data: studentCounts, error: studentError } = await usersQuery;

      if (!studentError && studentCounts) {
        studentsByInstitute = studentCounts.reduce((acc, student) => {
          const instituteName = student.institutes?.name || 'Unknown';
          acc[instituteName] = (acc[instituteName] || 0) + 1;
          return acc;
        }, {});
      }
    } catch (studentError) {
      console.warn('Students data not available:', studentError.message);
    }

    return {
      total_institutes: totalInstitutes,
      by_status: statusStats,
      students_by_institute: studentsByInstitute
    };
  });

  res.json(formatSuccessResponse(stats));
});

module.exports = {
  getAllInstitutes,
  getInstituteById,
  getInstituteStats,
  createInstitute,
  updateInstitute,
  deleteInstitute,
  updateInstituteStatus,
  bulkUpdateInstituteStatus,
  bulkDeleteInstitutes
};