// src/utils/databaseUtils.js
const { supabase } = require('../config/database');

/**
 * Generic paginated query builder
 * Eliminates duplicate pagination logic across controllers
 */
const buildPaginatedQuery = (tableName, selectFields = '*', options = {}) => {
  const {
    page = 1,
    limit = 20,
    filters = {},
    search = {},
    orderBy = 'created_at',
    ascending = false,
    includeCount = true
  } = options;

  let query = supabase
    .from(tableName)
    .select(selectFields, includeCount ? { count: 'exact' } : {});

  // Apply filters
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query = query.eq(key, value);
    }
  });

  // Apply search
  if (search.query && search.fields) {
    const searchConditions = search.fields
      .map(field => `${field}.ilike.%${search.query}%`)
      .join(',');
    query = query.or(searchConditions);
  }

  // Apply ordering
  query = query.order(orderBy, { ascending });

  // Apply pagination
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  query = query.range(from, to);

  return query;
};

/**
 * Check if record exists
 */
const recordExists = async (tableName, field, value) => {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('id')
      .eq(field, value)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    return !!data;
  } catch (error) {
    console.error(`Error checking if ${tableName} exists:`, error);
    throw error;
  }
};

/**
 * Generic bulk delete operation
 */
const bulkDelete = async (tableName, ids, options = {}) => {
  const { checkConstraints = true, protectedFields = {} } = options;

  try {
    // Check for protected records if specified
    if (checkConstraints && Object.keys(protectedFields).length > 0) {
      const { data: protectedRecords } = await supabase
        .from(tableName)
        .select(Object.keys(protectedFields).join(', '))
        .in('id', ids);

      if (protectedRecords) {
        const protected = protectedRecords.filter(record => {
          return Object.entries(protectedFields).some(([field, protectedValues]) => {
            return protectedValues.includes(record[field]);
          });
        });

        if (protected.length > 0) {
          return {
            success: false,
            error: 'Cannot delete protected records',
            protectedRecords: protected
          };
        }
      }
    }

    // Perform bulk delete
    const { error } = await supabase
      .from(tableName)
      .delete()
      .in('id', ids);

    if (error) throw error;

    return {
      success: true,
      deletedCount: ids.length
    };

  } catch (error) {
    console.error(`Bulk delete error for ${tableName}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Generic bulk status update operation
 */
const bulkUpdateStatus = async (tableName, ids, isActive) => {
  try {
    const { error } = await supabase
      .from(tableName)
      .update({
        status: isActive ? 'active' : 'inactive',
        updated_at: new Date().toISOString()
      })
      .in('id', ids);

    if (error) throw error;

    return {
      success: true,
      updatedCount: ids.length,
      newStatus: isActive ? 'active' : 'inactive'
    };

  } catch (error) {
    console.error(`Bulk status update error for ${tableName}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Generic single record fetch with relations
 */
const fetchRecordById = async (tableName, id, selectFields = '*') => {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(selectFields)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'Record not found', statusCode: 404 };
      }
      throw error;
    }

    return { success: true, data };

  } catch (error) {
    console.error(`Fetch record error for ${tableName}:`, error);
    return { success: false, error: error.message, statusCode: 500 };
  }
};

/**
 * Generic record creation
 */
const createRecord = async (tableName, data) => {
  try {
    const recordData = {
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newRecord, error } = await supabase
      .from(tableName)
      .insert(recordData)
      .select()
      .single();

    if (error) throw error;

    return { success: true, data: newRecord };

  } catch (error) {
    console.error(`Create record error for ${tableName}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Generic record update
 */
const updateRecord = async (tableName, id, data) => {
  try {
    const updateData = {
      ...data,
      updated_at: new Date().toISOString()
    };

    const { data: updatedRecord, error } = await supabase
      .from(tableName)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'Record not found', statusCode: 404 };
      }
      throw error;
    }

    return { success: true, data: updatedRecord };

  } catch (error) {
    console.error(`Update record error for ${tableName}:`, error);
    return { success: false, error: error.message };
  }
};

/**
 * Get table statistics
 */
const getTableStats = async (tableName, groupByFields = []) => {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*');

    if (error) throw error;

    const stats = {
      total: data.length
    };

    // Group by specified fields
    groupByFields.forEach(field => {
      stats[`by_${field}`] = data.reduce((acc, record) => {
        const value = record[field] || 'unknown';
        acc[value] = (acc[value] || 0) + 1;
        return acc;
      }, {});
    });

    return { success: true, stats };

  } catch (error) {
    console.error(`Get stats error for ${tableName}:`, error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  buildPaginatedQuery,
  recordExists,
  bulkDelete,
  bulkUpdateStatus,
  fetchRecordById,
  createRecord,
  updateRecord,
  getTableStats
};