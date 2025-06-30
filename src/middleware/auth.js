const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');

// Validate JWT secret on middleware load
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required for authentication');
  process.exit(1);
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError.message);
      return res.status(403).json({
        success: false,
        message: jwtError.name === 'TokenExpiredError' 
          ? 'Token has expired' 
          : 'Invalid token'
      });
    }

    // Validate user exists and is active
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, role, status')
      .eq('id', decoded.userId)
      .eq('status', 'active');

    if (error) {
      console.error('User validation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Authentication validation failed'
      });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user inactive'
      });
    }

    // Attach user to request
    req.user = users[0];
    next();

  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      console.log(`🚫 Access denied: User role '${req.user.role}' not in allowed roles [${roles.join(', ')}]`);
      return res.status(403).json({
        success: false,
        message: `Insufficient permissions. Required roles: ${roles.join(', ')}`
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles
};