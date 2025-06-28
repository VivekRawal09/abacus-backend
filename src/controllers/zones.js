const { supabase } = require('../config/database');

const getAllZones = async (req, res) => {
  try {
    const { data: zones, error } = await supabase
      .from('zones')
      .select('id, name, code, status, created_at');

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    res.json({ success: true, data: zones });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { getAllZones };