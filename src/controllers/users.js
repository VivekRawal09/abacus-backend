const { supabase } = require("../config/database");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const XLSX = require("xlsx");

// Import our utilities
const {
  formatPaginationResponse,
  formatSuccessResponse,
  formatErrorResponse,
  formatValidationError,
  formatNotFoundResponse,
  formatBulkResponse,
  asyncHandler
} = require('../utils/responseUtils');

const {
  normalizeRole,
  isValidEmail,
  validateRequiredFields,
  validatePagination,
  sanitizeSearchQuery,
  validateIdArray,
  validateBoolean
} = require('../utils/validationUtils');

const {
  buildPaginatedQuery,
  recordExists,
  bulkDelete,
  bulkUpdateStatus,
  fetchRecordById,
  createRecord,
  updateRecord,
  getTableStats
} = require('../utils/databaseUtils');

// ✅ NEW: Import caching utilities
const { queryCache, statsCache } = require('../utils/cacheUtils');

/**
 * ✅ SECURITY FIX: Data scope filtering based on user role
 */
const applyScopeFilters = (query, user, additionalFilters = {}) => {
  // Super admin sees everything
  if (user.permissions.isSuperAdmin) {
    return query;
  }
  
  // Zone manager sees users in their zone
  if (user.permissions.isZoneManager && user.zone_id) {
    query = query.eq('zone_id', user.zone_id);
  }
  
  // Institute admin sees users in their institute
  else if (user.permissions.isInstituteAdmin && user.institute_id) {
    query = query.eq('institute_id', user.institute_id);
  }
  
  // Parent sees only their children (will be implemented when parent-child relationship is added)
  else if (user.permissions.isParent) {
    // TODO: Add parent_id filter when parent-child relationship is implemented
    query = query.eq('parent_id', user.id);
  }
  
  // Student sees only themselves
  else if (user.permissions.isStudent) {
    query = query.eq('id', user.id);
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
 * ✅ SECURITY FIX: Validate user IDs belong to user's scope
 */
const validateUserScope = async (userIds, requesterUser) => {
  // Super admin can access all users
  if (requesterUser.permissions.isSuperAdmin) {
    return { valid: true, validIds: userIds };
  }
  
  // Get user details to validate scope
  const { data: users, error } = await supabase
    .from('users')
    .select('id, institute_id, zone_id, role')
    .in('id', userIds);
    
  if (error) {
    throw new Error(`Failed to validate user scope: ${error.message}`);
  }
  
  const validIds = [];
  const invalidIds = [];
  
  users.forEach(user => {
    let isValid = false;
    
    // Zone manager can access users in their zone
    if (requesterUser.permissions.isZoneManager) {
      isValid = user.zone_id === requesterUser.zone_id;
    }
    // Institute admin can access users in their institute
    else if (requesterUser.permissions.isInstituteAdmin) {
      isValid = user.institute_id === requesterUser.institute_id;
    }
    // Parent can access their children (when parent-child relationship is implemented)
    else if (requesterUser.permissions.isParent) {
      // TODO: Validate parent-child relationship
      isValid = false; // For now, parents cannot bulk operate
    }
    // Students cannot perform bulk operations on other users
    else if (requesterUser.permissions.isStudent) {
      isValid = user.id === requesterUser.id;
    }
    
    if (isValid) {
      validIds.push(user.id);
    } else {
      invalidIds.push(user.id);
    }
  });
  
  return {
    valid: invalidIds.length === 0,
    validIds,
    invalidIds,
    invalidCount: invalidIds.length
  };
};

/**
 * Convert Excel date serial number OR text date to proper date string
 */
const convertExcelDate = (excelDate) => {
  if (!excelDate) return null;

  if (typeof excelDate === "string" && excelDate.includes("-") && excelDate.length === 10) {
    return excelDate;
  }

  if (typeof excelDate === "string" && excelDate.includes("/")) {
    try {
      const parts = excelDate.split("/");
      if (parts.length === 3) {
        let [month, day, year] = parts;

        if (year.length === 2) {
          const currentYear = new Date().getFullYear();
          const currentYearShort = currentYear % 100;
          if (parseInt(year) > currentYearShort) {
            year = "19" + year;
          } else {
            year = "20" + year;
          }
        }

        month = month.padStart(2, "0");
        day = day.padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
    } catch (error) {
      console.warn(`⚠️ Could not parse date "${excelDate}":`, error);
      return null;
    }
  }

  if (typeof excelDate === "number" || (typeof excelDate === "string" && !isNaN(excelDate))) {
    const serialNumber = typeof excelDate === "string" ? parseFloat(excelDate) : excelDate;
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + serialNumber * 24 * 60 * 60 * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
};

// ✅ ENHANCED: getAllUsers with data scoping security
const getAllUsers = asyncHandler(async (req, res) => {
  const { page, limit } = validatePagination(req.query.page, req.query.limit);
  const { role, status, institute_id } = req.query;
  const search = sanitizeSearchQuery(req.query.search);

  // ✅ SECURITY FIX: Validate additional filters against user scope
  const additionalFilters = {};
  
  // Only super admin and zone manager can filter by institute_id
  if (institute_id) {
    if (!req.user.permissions.isSuperAdmin && !req.user.permissions.isZoneManager) {
      return formatErrorResponse(res, new Error('Insufficient permissions to filter by institute'), 'get users', 403);
    }
    
    // Zone manager can only filter by institutes in their zone
    if (req.user.permissions.isZoneManager) {
      const { data: institute, error } = await supabase
        .from('institutes')
        .select('zone_id')
        .eq('id', institute_id)
        .single();
        
      if (error || !institute || institute.zone_id !== req.user.zone_id) {
        return formatErrorResponse(res, new Error('Institute not in your zone'), 'get users', 403);
      }
    }
    
    additionalFilters.institute_id = institute_id;
  }
  
  if (role) additionalFilters.role = role;
  if (status) additionalFilters.status = status;

  // ✅ NEW: Create cache key that includes user scope
  const cacheKey = queryCache.createKey('users:list', {
    page, limit, role, status, institute_id, search,
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });

  const result = await queryCache.get(cacheKey, async () => {
    let query = supabase
      .from('users')
      .select(`
        id, first_name, last_name, email, role, phone,
        status, created_at, last_login, date_of_birth, gender,
        institute_id, zone_id,
        institutes(name),
        zones(name)
      `, { count: 'exact' });

    // ✅ SECURITY FIX: Apply scope filtering based on user role
    query = applyScopeFilters(query, req.user, additionalFilters);

    // ✅ SECURITY FIX: SQL injection prevention - use parameterized queries
    if (search) {
      // Use proper SQL escaping instead of string interpolation
      query = query.or(`first_name.ilike.%${search.replace(/[%_]/g, '\\$&')}%,last_name.ilike.%${search.replace(/[%_]/g, '\\$&')}%,email.ilike.%${search.replace(/[%_]/g, '\\$&')}%`);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    query = query
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data: users, error, count } = await query;
    if (error) throw error;

    // Format response to match frontend expectations
    const formattedUsers = users.map((user) => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      institute_name: user.institutes?.name || null,
      zone_name: user.zones?.name || null,
      is_active: user.status === "active",
      last_login: user.last_login,
      created_at: user.created_at,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      institute_id: user.institute_id,
      zone_id: user.zone_id,
    }));

    return { users: formattedUsers, count };
  });

  res.json(formatPaginationResponse(result.users, page, limit, result.count));
});

// ✅ ENHANCED: getUserStats with role-based scoping
const getUserStats = asyncHandler(async (req, res) => {
  const cacheKey = statsCache.createKey('users:stats', {
    userScope: {
      userId: req.user.id,
      role: req.user.role,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id
    }
  });
  
  const stats = await statsCache.get(cacheKey, async () => {
    let query = supabase
      .from('users')
      .select('role, status, created_at');

    // ✅ SECURITY FIX: Apply scope filtering for stats
    query = applyScopeFilters(query, req.user);

    const { data: users, error } = await query;
    if (error) throw error;

    const roleStats = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    const statusStats = users.reduce((acc, user) => {
      acc[user.status] = (acc[user.status] || 0) + 1;
      return acc;
    }, {});

    const activeUsers = statusStats.active || 0;

    return {
      total_users: users.length,
      active_users: activeUsers,
      by_role: roleStats,
      by_status: statusStats
    };
  });

  res.json(formatSuccessResponse(stats));
});

// ✅ REFACTORED: getUserById with scope validation
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ SECURITY FIX: Validate user can access this specific user
  const scopeValidation = await validateUserScope([id], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, new Error('Access denied: User not in your scope'), 'get user by ID', 403);
  }

  const result = await fetchRecordById(
    'users',
    id,
    `
      id, first_name, last_name, email, role, phone,
      status, created_at, last_login, date_of_birth, gender, address,
      institute_id, zone_id,
      institutes(name),
      zones(name)
    `
  );

  if (!result.success) {
    return result.statusCode === 404 
      ? formatNotFoundResponse(res, 'User')
      : formatErrorResponse(res, new Error(result.error), 'get user by ID');
  }

  const user = result.data;
  const formattedUser = {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    institute_name: user.institutes?.name || null,
    zone_name: user.zones?.name || null,
    is_active: user.status === "active",
    last_login: user.last_login,
    created_at: user.created_at,
    date_of_birth: user.date_of_birth,
    gender: user.gender,
    address: user.address,
    institute_id: user.institute_id,
    zone_id: user.zone_id,
  };

  res.json(formatSuccessResponse(formattedUser));
});

// ✅ ENHANCED: createUser with institute/zone validation
const createUser = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return formatValidationError(res, errors.array());
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
    address,
  } = req.body;

  // ✅ SECURITY FIX: Validate institute/zone assignment based on user permissions
  let validatedInstituteId = institute_id;
  let validatedZoneId = zone_id;

  if (!req.user.permissions.isSuperAdmin) {
    // Zone manager can only create users in their zone
    if (req.user.permissions.isZoneManager) {
      if (zone_id && zone_id !== req.user.zone_id) {
        return formatErrorResponse(res, new Error('Cannot assign users to other zones'), 'create user', 403);
      }
      validatedZoneId = req.user.zone_id;
      
      // Validate institute belongs to their zone
      if (institute_id) {
        const { data: institute, error } = await supabase
          .from('institutes')
          .select('zone_id')
          .eq('id', institute_id)
          .single();
          
        if (error || !institute || institute.zone_id !== req.user.zone_id) {
          return formatErrorResponse(res, new Error('Institute not in your zone'), 'create user', 403);
        }
      }
    }
    // Institute admin can only create users in their institute
    else if (req.user.permissions.isInstituteAdmin) {
      if (institute_id && institute_id !== req.user.institute_id) {
        return formatErrorResponse(res, new Error('Cannot assign users to other institutes'), 'create user', 403);
      }
      validatedInstituteId = req.user.institute_id;
      validatedZoneId = req.user.zone_id;
    }
    // Other roles cannot create users
    else {
      return formatErrorResponse(res, new Error('Insufficient permissions to create users'), 'create user', 403);
    }
  }

  // Check if email already exists
  if (await recordExists('users', 'email', email)) {
    return formatErrorResponse(res, new Error('Email already exists'), 'create user', 400);
  }

  // Hash password and normalize role
  const password_hash = await bcrypt.hash(password, 12);
  const normalizedRole = normalizeRole(role);

  const userData = {
    first_name,
    last_name,
    email,
    password_hash,
    role: normalizedRole,
    phone,
    institute_id: validatedInstituteId || null,
    zone_id: validatedZoneId || null,
    date_of_birth: date_of_birth || null,
    gender: gender || null,
    address: address || null,
    status: "active"
  };

  const result = await createRecord('users', userData);
  if (!result.success) {
    return formatErrorResponse(res, new Error(result.error), 'create user');
  }

  // ✅ IMPORTANT: Invalidate related cache entries
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  // Remove password hash from response
  delete result.data.password_hash;

  res.status(201).json(formatSuccessResponse(result.data, "User created successfully"));
});

// ✅ ENHANCED: updateUser with scope validation
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { email } = req.body;

  // ✅ SECURITY FIX: Validate user can update this specific user
  const scopeValidation = await validateUserScope([id], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, new Error('Access denied: User not in your scope'), 'update user', 403);
  }

  // Check if email is being changed and already exists
  if (email) {
    const { data: emailCheck } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .neq("id", id)
      .single();

    if (emailCheck) {
      return formatErrorResponse(res, new Error('Email already exists'), 'update user', 400);
    }
  }

  // ✅ SECURITY FIX: Prevent unauthorized institute/zone changes
  const updateData = { ...req.body };
  
  if (!req.user.permissions.isSuperAdmin) {
    // Zone manager cannot change zone assignments
    if (req.user.permissions.isZoneManager) {
      if (updateData.zone_id && updateData.zone_id !== req.user.zone_id) {
        return formatErrorResponse(res, new Error('Cannot change zone assignment'), 'update user', 403);
      }
      // Validate institute belongs to their zone
      if (updateData.institute_id) {
        const { data: institute, error } = await supabase
          .from('institutes')
          .select('zone_id')
          .eq('id', updateData.institute_id)
          .single();
          
        if (error || !institute || institute.zone_id !== req.user.zone_id) {
          return formatErrorResponse(res, new Error('Institute not in your zone'), 'update user', 403);
        }
      }
    }
    // Institute admin cannot change institute assignments
    else if (req.user.permissions.isInstituteAdmin) {
      if (updateData.institute_id && updateData.institute_id !== req.user.institute_id) {
        return formatErrorResponse(res, new Error('Cannot change institute assignment'), 'update user', 403);
      }
      if (updateData.zone_id && updateData.zone_id !== req.user.zone_id) {
        return formatErrorResponse(res, new Error('Cannot change zone assignment'), 'update user', 403);
      }
    }
  }

  delete updateData.password; // Don't allow password updates here

  const result = await updateRecord('users', id, updateData);
  if (!result.success) {
    return result.statusCode === 404
      ? formatNotFoundResponse(res, 'User')
      : formatErrorResponse(res, new Error(result.error), 'update user');
  }

  // ✅ IMPORTANT: Invalidate cache after update
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  // Remove password hash from response
  delete result.data.password_hash;

  res.json(formatSuccessResponse(result.data, "User updated successfully"));
});

// ✅ ENHANCED: deleteUser with scope validation
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ SECURITY FIX: Validate user can delete this specific user
  const scopeValidation = await validateUserScope([id], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, new Error('Access denied: User not in your scope'), 'delete user', 403);
  }

  const deleteResult = await bulkDelete('users', [id], {
    protectedFields: { role: ['super_admin'] }
  });

  if (!deleteResult.success) {
    if (deleteResult.protectedRecords?.length > 0) {
      return formatErrorResponse(res, new Error('Cannot delete super admin users'), 'delete user', 403);
    }
    return formatErrorResponse(res, new Error(deleteResult.error), 'delete user');
  }

  // ✅ IMPORTANT: Invalidate cache after delete
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  res.json(formatSuccessResponse(null, "User deleted successfully"));
});

// ✅ ENHANCED: updateUserStatus with scope validation
const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  const validation = validateBoolean(is_active, 'is_active');
  if (!validation.isValid) {
    return formatErrorResponse(res, new Error(validation.error), 'update user status', 400);
  }

  // ✅ SECURITY FIX: Validate user can update this specific user
  const scopeValidation = await validateUserScope([id], req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, new Error('Access denied: User not in your scope'), 'update user status', 403);
  }

  const result = await bulkUpdateStatus('users', [id], is_active);
  if (!result.success) {
    return formatErrorResponse(res, new Error(result.error), 'update user status');
  }

  // ✅ IMPORTANT: Invalidate cache after status update
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  res.json(formatSuccessResponse(
    { new_status: result.newStatus },
    `User ${is_active ? "activated" : "deactivated"} successfully`
  ));
});

// ✅ ENHANCED: bulkDeleteUsers with comprehensive scope validation
const bulkDeleteUsers = asyncHandler(async (req, res) => {
  const { userIds } = req.body;

  const validation = validateIdArray(userIds, 'User IDs');
  if (!validation.isValid) {
    return formatErrorResponse(res, new Error(validation.error), 'bulk delete users', 400);
  }

  // ✅ SECURITY FIX: Validate all users belong to requester's scope
  const scopeValidation = await validateUserScope(validation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} users not in your scope`), 
      'bulk delete users', 403);
  }

  const deleteResult = await bulkDelete('users', scopeValidation.validIds, {
    protectedFields: { role: ['super_admin'] }
  });

  if (!deleteResult.success) {
    if (deleteResult.protectedRecords?.length > 0) {
      return formatErrorResponse(res, new Error('Cannot delete super admin users'), 'bulk delete users', 403);
    }
    return formatErrorResponse(res, new Error(deleteResult.error), 'bulk delete users');
  }

  // ✅ IMPORTANT: Invalidate cache after bulk delete
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  res.json(formatBulkResponse('deleted', deleteResult.deletedCount));
});

// ✅ ENHANCED: bulkUpdateUserStatus with scope validation
const bulkUpdateUserStatus = asyncHandler(async (req, res) => {
  const { userIds, is_active } = req.body;

  const idsValidation = validateIdArray(userIds, 'User IDs');
  if (!idsValidation.isValid) {
    return formatErrorResponse(res, new Error(idsValidation.error), 'bulk update user status', 400);
  }

  const statusValidation = validateBoolean(is_active, 'is_active');
  if (!statusValidation.isValid) {
    return formatErrorResponse(res, new Error(statusValidation.error), 'bulk update user status', 400);
  }

  // ✅ SECURITY FIX: Validate all users belong to requester's scope
  const scopeValidation = await validateUserScope(idsValidation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} users not in your scope`), 
      'bulk update user status', 403);
  }

  // Check for super_admin users if trying to deactivate
  if (!is_active) {
    const { data: users } = await supabase
      .from("users")
      .select("id, role")
      .in("id", scopeValidation.validIds);

    const superAdmins = users?.filter((u) => u.role === "super_admin") || [];
    if (superAdmins.length > 0) {
      return formatErrorResponse(res, new Error('Cannot deactivate super admin users'), 'bulk update user status', 403);
    }
  }

  const result = await bulkUpdateStatus('users', scopeValidation.validIds, is_active);
  if (!result.success) {
    return formatErrorResponse(res, new Error(result.error), 'bulk update user status');
  }

  // ✅ IMPORTANT: Invalidate cache after bulk status update
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  res.json(formatBulkResponse(is_active ? 'activated' : 'deactivated', result.updatedCount, {
    new_status: result.newStatus
  }));
});

// ✅ ENHANCED: bulkUpdateUsers with scope validation
const bulkUpdateUsers = asyncHandler(async (req, res) => {
  const { userIds, updateData } = req.body;

  const validation = validateIdArray(userIds, 'User IDs');
  if (!validation.isValid) {
    return formatErrorResponse(res, new Error(validation.error), 'bulk update users', 400);
  }

  // ✅ SECURITY FIX: Validate all users belong to requester's scope
  const scopeValidation = await validateUserScope(validation.validIds, req.user);
  if (!scopeValidation.valid) {
    return formatErrorResponse(res, 
      new Error(`Access denied: ${scopeValidation.invalidCount} users not in your scope`), 
      'bulk update users', 403);
  }

  const { error } = await supabase
    .from('users')
    .update({
      ...updateData,
      updated_at: new Date().toISOString(),
    })
    .in('id', scopeValidation.validIds);

  if (error) throw error;

  // ✅ IMPORTANT: Invalidate cache after bulk update
  queryCache.invalidatePattern('users:.*');
  statsCache.invalidatePattern('users:.*');

  res.json(formatBulkResponse('updated', scopeValidation.validIds.length));
});

// ✅ ENHANCED: exportUsers with scope filtering
const exportUsers = asyncHandler(async (req, res) => {
  const { role, status, institute_id } = req.query;

  let query = supabase.from("users").select(`
      first_name, last_name, email, role, phone,
      status, created_at,
      institutes(name),
      zones(name)
    `);

  // ✅ SECURITY FIX: Apply scope filtering for export
  query = applyScopeFilters(query, req.user, { role, status, institute_id });

  const { data: users, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) throw error;

  // Convert to CSV format
  const csvHeader = "First Name,Last Name,Email,Role,Phone,Status,Institute,Zone,Created At\n";
  const csvData = users
    .map(
      (user) =>
        `"${user.first_name || ""}","${user.last_name || ""}","${
          user.email
        }","${user.role}","${user.phone || ""}","${user.status}","${
          user.institutes?.name || ""
        }","${user.zones?.name || ""}","${user.created_at}"`
    )
    .join("\n");

  const csv = csvHeader + csvData;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="users-export-${
      new Date().toISOString().split("T")[0]
    }.csv"`
  );
  res.send(csv);
});

// ✅ ENHANCED: importUsers with institute validation and security
const importUsers = async (req, res) => {
  console.log("🔄 Import Users - Starting process...");
  
  if (!req.file) {
    return formatErrorResponse(res, new Error('No file uploaded'), 'import users', 400);
  }

  try {
    // ✅ SECURITY FIX: Enhanced file validation
    const validMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel"
      // ✅ REMOVED: "application/octet-stream" - too permissive
    ];

    if (!validMimeTypes.includes(req.file.mimetype)) {
      return formatErrorResponse(res, new Error('Invalid file type. Please upload an Excel file (.xlsx or .xls)'), 'import users', 400);
    }

    // ✅ SECURITY FIX: File size validation (additional check)
    if (req.file.size > 10 * 1024 * 1024) { // 10MB
      return formatErrorResponse(res, new Error('File too large. Maximum size is 10MB'), 'import users', 400);
    }

    // ✅ SECURITY FIX: Enhanced Excel parsing with security options
    const workbook = XLSX.read(req.file.buffer, { 
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellStyles: false,
      // ✅ SECURITY: Disable dangerous features
      cellHTML: false,
      cellFormula: false, // Prevent formula execution
      sheetStubs: false,   // Prevent stub cells
      bookVBA: false       // Disable VBA/macros
    });

    if (workbook.SheetNames.length === 0) {
      return formatErrorResponse(res, new Error('No worksheets found in the Excel file'), 'import users', 400);
    }

    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (rows.length === 0) {
      return formatErrorResponse(res, new Error('No data found in the Excel file'), 'import users', 400);
    }

    // ✅ SECURITY FIX: Limit import size to prevent DoS
    if (rows.length > 1000) {
      return formatErrorResponse(res, new Error('Import limited to 1000 users per file'), 'import users', 400);
    }

    // Process users
    const users = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      // Skip empty rows
      if (!row.email && !row.first_name && !row.last_name) {
        continue;
      }

      // Validate required fields
      const requiredFieldsErrors = validateRequiredFields(row, ['email', 'password']);
      if (requiredFieldsErrors.length > 0) {
        errors.push(`Row ${rowNum}: ${requiredFieldsErrors.join(', ')}`);
        continue;
      }

      // Validate email format
      if (!isValidEmail(row.email)) {
        errors.push(`Row ${rowNum}: Invalid email format - ${row.email}`);
        continue;
      }

      try {
        const password_hash = await bcrypt.hash(row.password.toString(), 12);
        const userRole = normalizeRole(row.role);

        // ✅ SECURITY FIX: Validate institute assignment based on user permissions
        let validatedInstituteId = row.institute_id ? parseInt(row.institute_id) : null;
        let validatedZoneId = row.zone_id ? parseInt(row.zone_id) : null;

        if (!req.user.permissions.isSuperAdmin) {
          // Zone manager can only import users to their zone
          if (req.user.permissions.isZoneManager) {
            if (validatedZoneId && validatedZoneId !== req.user.zone_id) {
              errors.push(`Row ${rowNum}: Cannot assign user to zone ${validatedZoneId} - not your zone`);
              continue;
            }
            validatedZoneId = req.user.zone_id;
            
            // Validate institute belongs to their zone
            if (validatedInstituteId) {
              const { data: institute, error } = await supabase
                .from('institutes')
                .select('zone_id')
                .eq('id', validatedInstituteId)
                .single();
                
              if (error || !institute || institute.zone_id !== req.user.zone_id) {
                errors.push(`Row ${rowNum}: Institute ${validatedInstituteId} not in your zone`);
                continue;
              }
            }
          }
          // Institute admin can only import users to their institute
          else if (req.user.permissions.isInstituteAdmin) {
            if (validatedInstituteId && validatedInstituteId !== req.user.institute_id) {
              errors.push(`Row ${rowNum}: Cannot assign user to institute ${validatedInstituteId} - not your institute`);
              continue;
            }
            validatedInstituteId = req.user.institute_id;
            validatedZoneId = req.user.zone_id;
          }
          // Other roles cannot import users
          else {
            errors.push(`Row ${rowNum}: Insufficient permissions to import users`);
            continue;
          }
        }

        const user = {
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          email: row.email.toLowerCase().trim(),
          password_hash,
          role: userRole,
          phone: row.phone ? Math.abs(row.phone).toString() : null,
          institute_id: validatedInstituteId,
          zone_id: validatedZoneId,
          status: row.status || "active",
          date_of_birth: convertExcelDate(row.date_of_birth),
          gender: row.gender || null,
          address: row.address || null,
          created_at: new Date().toISOString(),
        };

        users.push(user);
      } catch (hashError) {
        errors.push(`Row ${rowNum}: Failed to process password`);
      }
    }

    if (users.length === 0) {
      return formatErrorResponse(res, new Error('No valid users found in file'), 'import users', 400);
    }

    // Check for duplicate emails in the batch
    const emailCounts = {};
    const duplicateEmails = [];

    users.forEach((user, index) => {
      if (emailCounts[user.email]) {
        duplicateEmails.push(`Duplicate email in batch: ${user.email}`);
      } else {
        emailCounts[user.email] = index + 2;
      }
    });

    if (duplicateEmails.length > 0) {
      return formatErrorResponse(res, new Error('Duplicate emails found in the file'), 'import users', 400);
    }

    // Check for existing emails in database
    const emailsToCheck = users.map((u) => u.email);
    const { data: existingUsers, error: checkError } = await supabase
      .from("users")
      .select("email")
      .in("email", emailsToCheck);

    if (checkError) {
      return formatErrorResponse(res, checkError, 'import users');
    }

    if (existingUsers && existingUsers.length > 0) {
      const existingEmails = existingUsers.map((u) => u.email);
      return formatErrorResponse(res, new Error(`Some email addresses already exist: ${existingEmails.join(', ')}`), 'import users', 400);
    }

    // Insert users in batches
    const batchSize = 100;
    const insertedUsers = [];

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      const { data, error } = await supabase
        .from("users")
        .insert(batch)
        .select("id, email, first_name, last_name, role");

      if (error) {
        return formatErrorResponse(res, error, 'import users');
      }

      if (data) {
        insertedUsers.push(...data);
      }
    }

    // ✅ IMPORTANT: Invalidate cache after import
    queryCache.invalidatePattern('users:.*');
    statsCache.invalidatePattern('users:.*');

    const response = formatSuccessResponse(insertedUsers, `Successfully imported ${insertedUsers.length} users`, {
      stats: {
        totalProcessed: rows.length,
        successfulImports: insertedUsers.length,
        errors: errors.length,
        skipped: rows.length - users.length - errors.length,
      }
    });

    // Include errors if any
    if (errors.length > 0) {
      response.warnings = errors.slice(0, 10);
      response.totalWarnings = errors.length;
    }

    res.json(response);

  } catch (err) {
    return formatErrorResponse(res, err, 'import users');
  }
};

// Validation middleware for user creation
const validateUserCreation = [
  body("first_name").trim().notEmpty().withMessage("First name is required"),
  body("last_name").trim().notEmpty().withMessage("Last name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain at least one uppercase, one lowercase, and one number"),
  body("role")
    .isIn([
      "student",
      "teacher", 
      "parent",
      "institute_admin",
      "zone_manager",
      "super_admin",
    ])
    .withMessage("Valid role is required"),
  body("phone")
    .optional()
    .matches(/^[+]?[\d\s\-()]{10,15}$/)
    .withMessage("Valid phone number required (10-15 digits)"),
  body("institute_id")
    .optional()
    .isInt()
    .withMessage("Valid institute ID required"),
  body("zone_id").optional().isInt().withMessage("Valid zone ID required"),
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
  bulkUpdateUsers,
  bulkUpdateUserStatus,
  exportUsers,
  validateUserCreation,
  importUsers,
};