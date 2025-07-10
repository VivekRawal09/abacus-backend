const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');

// ✅ SECURITY FIX: Enhanced JWT secret validation with fallback
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required for authentication');
  console.error('💡 Generate a secure secret: node -p "require(\'crypto\').randomBytes(32).toString(\'hex\')"');
  
  // ✅ FIXED: Graceful degradation instead of crashing
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    console.warn('⚠️ Using development fallback - NOT SECURE FOR PRODUCTION');
    process.env.JWT_SECRET = 'dev-fallback-key-' + require('crypto').randomBytes(16).toString('hex');
  }
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ✅ SECURITY FIX: Rate limiting for authentication attempts
const authAttempts = new Map();
const maxAttempts = 5;
const lockoutDuration = 15 * 60 * 1000; // 15 minutes

const isRateLimited = (identifier) => {
  const attempts = authAttempts.get(identifier);
  if (!attempts) return false;
  
  if (attempts.count >= maxAttempts && Date.now() - attempts.lastAttempt < lockoutDuration) {
    return true;
  }
  
  // Clean up expired entries
  if (Date.now() - attempts.lastAttempt > lockoutDuration) {
    authAttempts.delete(identifier);
    return false;
  }
  
  return false;
};

const recordFailedAttempt = (identifier) => {
  const attempts = authAttempts.get(identifier) || { count: 0, lastAttempt: 0 };
  attempts.count++;
  attempts.lastAttempt = Date.now();
  authAttempts.set(identifier, attempts);
};

const clearFailedAttempts = (identifier) => {
  authAttempts.delete(identifier);
};

// ✅ SECURITY FIX: Enhanced authentication with concurrent session protection
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    // ✅ SECURITY FIX: Rate limiting by IP
    if (isRateLimited(clientIP)) {
      return res.status(429).json({
        success: false,
        message: 'Too many authentication attempts. Please try again later.',
        retryAfter: Math.ceil(lockoutDuration / 1000)
      });
    }

    if (!token) {
      recordFailedAttempt(clientIP);
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // ✅ SECURITY FIX: Enhanced JWT verification with additional checks
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'abacus-backend',
        audience: 'abacus-frontend',
        maxAge: '24h' // ✅ SECURITY: Enforce max token age
      });
    } catch (jwtError) {
      recordFailedAttempt(clientIP);
      console.log('JWT verification failed:', {
        error: jwtError.message,
        ip: clientIP,
        userAgent: req.headers['user-agent']?.substring(0, 100)
      });
      
      return res.status(403).json({
        success: false,
        message: jwtError.name === 'TokenExpiredError'
          ? 'Token has expired'
          : 'Invalid token'
      });
    }

    // ✅ SECURITY FIX: Validate user exists, is active, AND role hasn't changed
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, role, status, institute_id, zone_id, last_login, created_at')
      .eq('id', decoded.userId)
      .eq('status', 'active')
      .single(); // ✅ Use single() to ensure exactly one user

    if (error) {
      recordFailedAttempt(clientIP);
      console.error('User validation error:', {
        error: error.message,
        userId: decoded.userId,
        ip: clientIP
      });
      return res.status(500).json({
        success: false,
        message: 'Authentication validation failed'
      });
    }

    if (!users) {
      recordFailedAttempt(clientIP);
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user inactive'
      });
    }

    // ✅ SECURITY FIX: Verify role hasn't changed since token was issued
    if (users.role !== decoded.role) {
      recordFailedAttempt(clientIP);
      console.warn('Role mismatch detected:', {
        userId: decoded.userId,
        tokenRole: decoded.role,
        actualRole: users.role,
        ip: clientIP
      });
      return res.status(401).json({
        success: false,
        message: 'User permissions have changed. Please login again.'
      });
    }

    // ✅ FIXED: Corrected password change detection logic
    // Only check if last_login is after token issue AND it's a significant time difference
    const tokenIssuedAt = new Date(decoded.iat * 1000);
    const lastLoginTime = users.last_login ? new Date(users.last_login) : null;
    const accountCreatedAt = new Date(users.created_at);
    
    // Only invalidate if:
    // 1. User has a last_login time
    // 2. Token was issued before the last_login
    // 3. The difference is more than 1 minute (to account for clock differences)
    if (lastLoginTime && 
        tokenIssuedAt < lastLoginTime && 
        (lastLoginTime - tokenIssuedAt) > 60000) { // 1 minute buffer
      
      console.warn('Token issued before recent login:', {
        userId: decoded.userId,
        tokenIssuedAt: tokenIssuedAt.toISOString(),
        lastLogin: lastLoginTime.toISOString(),
        ip: clientIP
      });
      
      recordFailedAttempt(clientIP);
      return res.status(401).json({
        success: false,
        message: 'Session invalidated due to recent login. Please login again.'
      });
    }

    // ✅ SECURITY SUCCESS: Clear failed attempts on successful auth
    clearFailedAttempts(clientIP);

    // ✅ SECURITY FIX: Attach comprehensive user context for authorization
    req.user = {
      id: users.id,
      email: users.email,
      role: users.role,
      institute_id: users.institute_id,
      zone_id: users.zone_id,
      // ✅ SECURITY: Add derived permissions for quick access
      permissions: {
        isSuperAdmin: users.role === 'super_admin',
        isZoneManager: users.role === 'zone_manager', 
        isInstituteAdmin: users.role === 'institute_admin',
        isParent: users.role === 'parent',
        isStudent: users.role === 'student',
        canAccessAllInstitutes: users.role === 'super_admin',
        canAccessZone: users.role === 'super_admin' || users.role === 'zone_manager',
        canAccessInstitute: users.role === 'super_admin' || users.role === 'zone_manager' || users.role === 'institute_admin'
      }
    };

    // ✅ SECURITY FIX: Log successful authentication for audit trail
    console.log('✅ Authentication successful:', {
      userId: users.id,
      role: users.role,
      ip: clientIP,
      endpoint: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    recordFailedAttempt(req.ip || 'unknown');
    console.error('Authentication middleware error:', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      ip: req.ip || 'unknown'
    });
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// ✅ SECURITY FIX: Enhanced role authorization with data scoping
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // ✅ SECURITY FIX: Verify role against database data, not just JWT
    if (!allowedRoles.includes(req.user.role)) {
      console.log('🚫 Access denied:', {
        userId: req.user.id,
        userRole: req.user.role,
        allowedRoles: allowedRoles,
        endpoint: req.path,
        method: req.method,
        ip: req.ip || 'unknown'
      });
      
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`,
        userRole: req.user.role
      });
    }

    // ✅ SECURITY FIX: Add request context for data scoping
    req.dataScope = {
      // Define what data this user can access
      userId: req.user.id,
      instituteId: req.user.institute_id,
      zoneId: req.user.zone_id,
      role: req.user.role,
      
      // Helper functions for controllers to use
      canAccessUser: (targetUserId) => {
        if (req.user.permissions.isSuperAdmin) return true;
        if (req.user.permissions.isZoneManager && req.user.zone_id) return true; // Will be validated in controller
        if (req.user.permissions.isInstituteAdmin && req.user.institute_id) return true; // Will be validated in controller
        if (req.user.permissions.isParent) return false; // Will be validated against parent-child relationship
        if (req.user.permissions.isStudent) return targetUserId === req.user.id;
        return false;
      },
      
      canAccessInstitute: (targetInstituteId) => {
        if (req.user.permissions.isSuperAdmin) return true;
        if (req.user.permissions.isZoneManager) return true; // Will be validated against zone
        if (req.user.permissions.isInstituteAdmin) return targetInstituteId === req.user.institute_id;
        return false;
      },
      
      canAccessZone: (targetZoneId) => {
        if (req.user.permissions.isSuperAdmin) return true;
        if (req.user.permissions.isZoneManager) return targetZoneId === req.user.zone_id;
        return false;
      }
    };

    next();
  };
};

// ✅ SECURITY FIX: Data scope validation middleware
const validateDataScope = (resourceType) => {
  return async (req, res, next) => {
    if (!req.user || !req.dataScope) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Super admin can access everything
    if (req.user.permissions.isSuperAdmin) {
      return next();
    }

    const resourceId = req.params.id;
    
    try {
      switch (resourceType) {
        case 'user':
          if (resourceId) {
            // Validate user access for specific user operations
            const { data: targetUser, error } = await supabase
              .from('users')
              .select('id, institute_id, zone_id, role')
              .eq('id', resourceId)
              .single();

            if (error || !targetUser) {
              return res.status(404).json({
                success: false,
                message: 'User not found'
              });
            }

            // Zone manager can access users in their zone
            if (req.user.permissions.isZoneManager) {
              if (targetUser.zone_id !== req.user.zone_id) {
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: User not in your zone'
                });
              }
            }
            // Institute admin can access users in their institute
            else if (req.user.permissions.isInstituteAdmin) {
              if (targetUser.institute_id !== req.user.institute_id) {
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: User not in your institute'
                });
              }
            }
            // Students can only access themselves
            else if (req.user.permissions.isStudent) {
              if (targetUser.id !== req.user.id) {
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: Can only access your own data'
                });
              }
            }
          }
          break;

        case 'institute':
          if (resourceId) {
            const { data: targetInstitute, error } = await supabase
              .from('institutes')
              .select('id, zone_id')
              .eq('id', resourceId)
              .single();

            if (error || !targetInstitute) {
              return res.status(404).json({
                success: false,
                message: 'Institute not found'
              });
            }

            // Zone manager can access institutes in their zone
            if (req.user.permissions.isZoneManager) {
              if (targetInstitute.zone_id !== req.user.zone_id) {
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: Institute not in your zone'
                });
              }
            }
            // Institute admin can only access their institute
            else if (req.user.permissions.isInstituteAdmin) {
              if (targetInstitute.id !== req.user.institute_id) {
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: Not your institute'
                });
              }
            }
          }
          break;
      }

      next();

    } catch (error) {
      console.error('Data scope validation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Access validation failed'
      });
    }
  };
};

// ✅ SECURITY FIX: Clean up rate limiting data periodically
setInterval(() => {
  const now = Date.now();
  for (const [identifier, attempts] of authAttempts.entries()) {
    if (now - attempts.lastAttempt > lockoutDuration) {
      authAttempts.delete(identifier);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

module.exports = {
  authenticateToken,
  authorizeRoles,
  validateDataScope
};