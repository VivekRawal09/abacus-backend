// src/utils/validationUtils.js - UPDATED WITH STANDARDIZED BULK VALIDATION

/**
 * Role mapping utility - eliminates duplicate role mapping logic
 */
const ROLE_MAPPINGS = {
  student: "student",
  teacher: "institute_admin",
  parent: "parent",
  institute_admin: "institute_admin",
  instituteadmin: "institute_admin",
  "institute admin": "institute_admin",
  admin: "institute_admin",
  zone_manager: "zone_manager", // ✅ FIXED: Keep zone_manager as separate role
  zonemanager: "zone_manager",
  "zone manager": "zone_manager",
  manager: "zone_manager",
  super_admin: "super_admin",
  superadmin: "super_admin",
  "super admin": "super_admin",
  super: "super_admin",
};

const VALID_ROLES = ["student", "parent", "teacher", "institute_admin", "zone_manager", "super_admin"];

/**
 * Normalize and validate user role
 */
const normalizeRole = (role) => {
  if (!role) return "student";
  const normalizedRole = role.toLowerCase().trim();
  const mappedRole = ROLE_MAPPINGS[normalizedRole] || "student";
  if (!VALID_ROLES.includes(mappedRole)) {
    console.warn(`⚠️ Invalid role "${role}", defaulting to "student"`);
    return "student";
  }
  return mappedRole;
};

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number format
 */
const isValidPhone = (phone) => {
  const phoneRegex = /^[+]?[\d\s\-()]{10,15}$/;
  return phoneRegex.test(phone);
};

/**
 * Validate YouTube video ID format
 */
const isValidYouTubeVideoId = (videoId) => {
  const regex = /^[a-zA-Z0-9_-]{11}$/;
  return regex.test(videoId);
};

/**
 * Extract YouTube video ID from URL
 */
const extractYouTubeVideoId = (url) => {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
};

/**
 * Validate required fields
 */
const validateRequiredFields = (data, requiredFields) => {
  const errors = [];
  
  requiredFields.forEach(field => {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      errors.push(`${field} is required`);
    }
  });
  
  return errors;
};

/**
 * Validate pagination parameters
 */
const validatePagination = (page, limit) => {
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  
  return {
    page: Math.max(1, pageNum),
    limit: Math.min(100, Math.max(1, limitNum)) // Max 100 items per page
  };
};

/**
 * Sanitize search query
 */
const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return '';
  
  return query
    .trim()
    .replace(/[<>]/g, '') // Remove potential XSS characters
    .substring(0, 100); // Limit length
};

/**
 * ✅ UPDATED: Universal ID validation for both integers and UUIDs
 */
const validateIdArray = (ids, fieldName = 'IDs', options = {}) => {
  const { 
    idType = 'auto',      // 'integer', 'uuid', or 'auto'
    allowEmpty = false,   // Allow empty arrays
    maxItems = 1000       // Maximum items allowed
  } = options;

  // Basic array validation
  if (!ids || !Array.isArray(ids)) {
    return { isValid: false, error: `${fieldName} must be an array` };
  }
  
  if (ids.length === 0 && !allowEmpty) {
    return { isValid: false, error: `${fieldName} array cannot be empty` };
  }

  if (ids.length > maxItems) {
    return { isValid: false, error: `${fieldName} array cannot exceed ${maxItems} items` };
  }

  // Auto-detect ID type if not specified
  let detectedType = idType;
  if (idType === 'auto' && ids.length > 0) {
    const firstId = ids[0];
    if (typeof firstId === 'string' && firstId.includes('-') && firstId.length === 36) {
      detectedType = 'uuid';
    } else {
      detectedType = 'integer';
    }
  }

  const invalidIds = [];
  const validIds = [];

  if (detectedType === 'uuid') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    ids.forEach((id, index) => {
      if (!id || typeof id !== 'string' || !uuidRegex.test(id)) {
        invalidIds.push({ id, index });
      } else {
        validIds.push(id);
      }
    });
  } else {
    // Integer validation
    ids.forEach((id, index) => {
      const parsedId = parseInt(id);
      if (!id || isNaN(parsedId) || parsedId <= 0) {
        invalidIds.push({ id, index });
      } else {
        validIds.push(parsedId);
      }
    });
  }

  if (invalidIds.length > 0) {
    const invalidSample = invalidIds.slice(0, 3).map(item => item.id).join(', ');
    const moreText = invalidIds.length > 3 ? ` and ${invalidIds.length - 3} more` : '';
    
    return { 
      isValid: false, 
      error: `Invalid ${fieldName} format: ${invalidSample}${moreText}`,
      invalidIds: invalidIds
    };
  }

  return { 
    isValid: true, 
    validIds, 
    idType: detectedType,
    count: validIds.length
  };
};

/**
 * ✅ NEW: Validate UUID format specifically
 */
const validateUUID = (uuid, fieldName = 'ID') => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!uuid || typeof uuid !== 'string') {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  if (!uuidRegex.test(uuid)) {
    return { isValid: false, error: `Invalid ${fieldName} format` };
  }
  
  return { isValid: true, uuid };
};

/**
 * ✅ NEW: Validate array of UUIDs specifically
 */
const validateUUIDArray = (uuids, fieldName = 'IDs', maxItems = 100) => {
  return validateIdArray(uuids, fieldName, { 
    idType: 'uuid', 
    maxItems 
  });
};

/**
 * ✅ NEW: Validate array of integers specifically
 */
const validateIntegerArray = (integers, fieldName = 'IDs', maxItems = 100) => {
  return validateIdArray(integers, fieldName, { 
    idType: 'integer', 
    maxItems 
  });
};

/**
 * Validate status field
 */
const validateStatus = (status) => {
  const validStatuses = ['active', 'inactive'];
  return validStatuses.includes(status) ? status : 'active';
};

/**
 * ✅ UPDATED: Validate boolean field with better error handling
 */
const validateBoolean = (value, fieldName) => {
  if (value === undefined || value === null) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  if (typeof value !== 'boolean') {
    return { isValid: false, error: `${fieldName} must be a boolean value` };
  }
  
  return { isValid: true, value };
};

/**
 * ✅ NEW: Validate bulk operation limits
 */
const validateBulkLimits = (count, operation = 'operation', maxItems = 100) => {
  if (count > maxItems) {
    return { 
      isValid: false, 
      error: `Bulk ${operation} limited to ${maxItems} items at a time` 
    };
  }
  
  return { isValid: true };
};

/**
 * ✅ NEW: Validate confirmation for dangerous operations
 */
const validateConfirmation = (confirmValue, operation = 'operation') => {
  if (!confirmValue) {
    return { 
      isValid: false, 
      error: `${operation} requires explicit confirmation. Include "confirmDelete": true in request body.` 
    };
  }
  
  return { isValid: true };
};

module.exports = {
  // Existing exports
  ROLE_MAPPINGS,
  VALID_ROLES,
  normalizeRole,
  isValidEmail,
  isValidPhone,
  isValidYouTubeVideoId,
  extractYouTubeVideoId,
  validateRequiredFields,
  validatePagination,
  sanitizeSearchQuery,
  validateStatus,
  
  // ✅ UPDATED: Enhanced ID validation
  validateIdArray,
  validateBoolean,
  
  // ✅ NEW: Specific validation functions
  validateUUID,
  validateUUIDArray,
  validateIntegerArray,
  validateBulkLimits,
  validateConfirmation
};