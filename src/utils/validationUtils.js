// src/utils/validationUtils.js

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
  zone_manager: "institute_admin",
  zonemanager: "institute_admin",
  "zone manager": "institute_admin",
  manager: "institute_admin",
  super_admin: "super_admin",
  superadmin: "super_admin",
  "super admin": "super_admin",
  super: "super_admin",
};

const VALID_ROLES = ["student", "parent", "institute_admin", "super_admin"];

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
 * Validate array of IDs
 */
const validateIdArray = (ids, fieldName = 'IDs') => {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { isValid: false, error: `${fieldName} array is required` };
  }
  
  const invalidIds = ids.filter(id => !id || isNaN(parseInt(id)));
  if (invalidIds.length > 0) {
    return { isValid: false, error: `Invalid ${fieldName}: ${invalidIds.join(', ')}` };
  }
  
  return { isValid: true, validIds: ids.map(id => parseInt(id)) };
};

/**
 * Validate status field
 */
const validateStatus = (status) => {
  const validStatuses = ['active', 'inactive'];
  return validStatuses.includes(status) ? status : 'active';
};

/**
 * Validate boolean field
 */
const validateBoolean = (value, fieldName) => {
  if (typeof value !== 'boolean') {
    return { isValid: false, error: `${fieldName} must be a boolean value` };
  }
  return { isValid: true, value };
};

module.exports = {
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
  validateIdArray,
  validateStatus,
  validateBoolean
};