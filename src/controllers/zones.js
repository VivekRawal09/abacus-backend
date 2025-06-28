const { supabase } = require('../config/database');

const getAllZones = async (req, res) => {
  try {
    const { data: zones, error } = await supabase
      .from('zones')
      .select('id, name, code, description, region, created_at, updated_at');

    if (error) {
      console.error('Supabase error:', error.message); // Add this for debugging
      return res.status(500).json({ success: false, message: error.message });
    }

    res.json({ success: true, data: zones });
  } catch (err) {
    console.error('Controller error:', err.message); // Add this for debugging
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { getAllZones };