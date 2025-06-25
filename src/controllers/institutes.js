const { supabase } = require('../config/database');

const getAllInstitutes = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    
    let query = supabase
      .from('institutes')
      .select(`
        id, name, code, address, city, state, pincode,
        phone, email, established_date, status, created_at,
        zones(name, code)
      `, { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,city.ilike.%${search}%`);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data: institutes, error, count } = await query
      .range(from, to)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: institutes,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(count / limit),
        total_items: count,
        items_per_page: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get institutes error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getInstituteById = async (req, res) => {
  try {
    const { id } = req.params;
    
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
      return res.status(404).json({
        success: false,
        message: 'Institute not found'
      });
    }

    res.json({
      success: true,
      data: institute
    });

  } catch (error) {
    console.error('Get institute error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const getInstituteStats = async (req, res) => {
  try {
    // Get total institutes
    const { count: totalInstitutes, error: instituteError } = await supabase
      .from('institutes')
      .select('*', { count: 'exact', head: true });

    if (instituteError) throw instituteError;

    // Get institutes by status
    const { data: instituteStatusData, error: statusError } = await supabase
      .from('institutes')
      .select('status');

    if (statusError) throw statusError;

    const statusStats = instituteStatusData.reduce((acc, inst) => {
      acc[inst.status] = (acc[inst.status] || 0) + 1;
      return acc;
    }, {});

    // Get student count per institute
    const { data: studentCounts, error: studentError } = await supabase
      .from('students')
      .select('institute_id, institutes(name)');

    if (studentError) throw studentError;

    const studentsByInstitute = studentCounts.reduce((acc, student) => {
      const instituteName = student.institutes?.name || 'Unknown';
      acc[instituteName] = (acc[instituteName] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      stats: {
        total_institutes: totalInstitutes,
        by_status: statusStats,
        students_by_institute: studentsByInstitute
      }
    });

  } catch (error) {
    console.error('Get institute stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  getAllInstitutes,
  getInstituteById,
  getInstituteStats
};