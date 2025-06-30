// src/utils/responseUtils.js - Fixed Response Utilities

/**
 * Standardized pagination response format
 * Eliminates duplicate pagination code across controllers
 */
const formatPaginationResponse = (data, page, limit, totalCount, additionalData = {}) => {
  return {
    success: true,
    data: data,
    pagination: {
      currentPage: parseInt(page),
      totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 0, // ✅ FIXED: Division by zero protection
      totalItems: totalCount,
      pageSize: parseInt(limit)
    },
    ...additionalData,
    timestamp: new Date().toISOString()
  };
};

/**
 * Standardized success response format
 */
const formatSuccessResponse = (data, message = null, additionalData = {}) => {
  const response = {
    success: true,
    ...additionalData
  };
  
  if (message) response.message = message;
  if (data !== undefined) response.data = data;
  response.timestamp = new Date().toISOString();
  
  return response;
};

/**
 * Standardized error response format
 * Eliminates duplicate error handling across controllers
 */
const formatErrorResponse = (res, error, operation, statusCode = 500) => {
  console.error(`${operation} error:`, error);
  
  // Determine appropriate error message
  let message = 'Internal server error';
  let details = null;
  
  if (error.message) {
    if (error.message.includes('duplicate key')) {
      message = 'A record with this information already exists';
      statusCode = 400;
    } else if (error.message.includes('foreign key')) {
      message = 'Invalid reference to related data';
      statusCode = 400;
    } else if (error.message.includes('not found')) {
      message = 'Requested resource not found';
      statusCode = 404;
    } else if (error.message.includes('unauthorized') || error.message.includes('permission')) {
      message = 'Insufficient permissions';
      statusCode = 403;
    } else if (process.env.NODE_ENV === 'development') {
      message = error.message;
      details = error.stack;
    }
  }
  
  return res.status(statusCode).json({
    success: false,
    message: message,
    operation: operation,
    details: details,
    timestamp: new Date().toISOString()
  });
};

/**
 * Standardized validation error response
 */
const formatValidationError = (res, validationErrors) => {
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors: validationErrors,
    timestamp: new Date().toISOString()
  });
};

/**
 * Standardized not found response
 */
const formatNotFoundResponse = (res, resource = 'Resource') => {
  return res.status(404).json({
    success: false,
    message: `${resource} not found`,
    timestamp: new Date().toISOString()
  });
};

/**
 * ✅ FIXED: Standardized bulk operation response (removed res parameter)
 */
const formatBulkResponse = (operation, count, additionalData = {}) => {
  return {
    success: true,
    message: `${count} items ${operation} successfully`,
    data: {
      processed_count: count,
      ...additionalData
    },
    timestamp: new Date().toISOString()
  };
};

/**
 * Handle async route operations with standardized error handling
 */
const asyncHandler = (operation) => {
  return (req, res, next) => {
    Promise.resolve(operation(req, res, next)).catch((error) => {
      formatErrorResponse(res, error, 'Operation');
    });
  };
};

/**
 * ✅ NEW: Cache-aware response helper
 */
const formatCachedResponse = (data, fromCache = false, additionalData = {}) => {
  return {
    success: true,
    data,
    cached: fromCache,
    ...additionalData,
    timestamp: new Date().toISOString()
  };
};

/**
 * ✅ NEW: Performance-enhanced response with timing
 */
const formatPerformanceResponse = (data, startTime, additionalData = {}) => {
  const responseTime = Date.now() - startTime;
  
  return {
    success: true,
    data,
    performance: {
      responseTime: `${responseTime}ms`,
      fast: responseTime < 100,
      slow: responseTime > 1000
    },
    ...additionalData,
    timestamp: new Date().toISOString()
  };
};

module.exports = {
  formatPaginationResponse,
  formatSuccessResponse,
  formatErrorResponse,
  formatValidationError,
  formatNotFoundResponse,
  formatBulkResponse,
  asyncHandler,
  formatCachedResponse,
  formatPerformanceResponse
};