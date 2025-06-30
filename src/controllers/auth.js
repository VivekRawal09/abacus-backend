const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');

// Validate JWT secret on startup
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET environment variable is required');
  console.error('💡 Generate a secure secret: node -p "require(\'crypto\').randomBytes(32).toString(\'hex\')"');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters long');
  process.exit(1);
}

const generateToken = (userId, email, role) => {
  try {
    return jwt.sign(
      { userId, email, role },
      process.env.JWT_SECRET,
      { 
        expiresIn: '24h',
        issuer: 'abacus-backend',
        audience: 'abacus-frontend'
      }
    );
  } catch (error) {
    console.error('❌ Token generation failed:', error);
    throw new Error('Failed to generate authentication token');
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔍 Login attempt for:', email);

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Find user with institute info
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        *,
        institutes(name)
      `)
      .eq('email', email.toLowerCase().trim())
      .eq('status', 'active');

    console.log('📊 Database query result:', { userCount: users?.length, error });

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({
        success: false,
        message: 'Database error occurred'
      });
    }

    if (!users || users.length === 0) {
      console.log('❌ No user found with email:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];
    console.log('✅ User found:', { id: user.id, email: user.email, role: user.role });

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    console.log('🔑 Password validation:', isPasswordValid ? 'SUCCESS' : 'FAILED');

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generate JWT token
    const token = generateToken(user.id, user.email, user.role);

    console.log('✅ Login successful for:', user.email);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          instituteName: user.institutes?.name || null
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id, first_name, last_name, email, role, phone,
        status, created_at, date_of_birth, gender,
        institutes(name),
        zones(name)
      `)
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Profile fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch profile'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        institute_name: user.institutes?.name || null,
        zone_name: user.zones?.name || null,
        is_active: user.status === 'active',
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = { login, getProfile };