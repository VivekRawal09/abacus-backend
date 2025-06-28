const { supabase } = require("../config/database");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const XLSX = require("xlsx");

/**
 * Convert Excel date serial number to proper date string
 * Excel stores dates as serial numbers (days since 1900-01-01)
 */
/**
 * Convert Excel date serial number OR text date to proper date string
 */
const convertExcelDate = (excelDate) => {
  if (!excelDate) return null;

  // If it's already a proper date string (YYYY-MM-DD), return as is
  if (
    typeof excelDate === "string" &&
    excelDate.includes("-") &&
    excelDate.length === 10
  ) {
    return excelDate;
  }

  // Handle text dates like "3/15/10", "12/8/85"
  if (typeof excelDate === "string" && excelDate.includes("/")) {
    try {
      const parts = excelDate.split("/");
      if (parts.length === 3) {
        let [month, day, year] = parts;

        // Handle 2-digit years
        if (year.length === 2) {
          const currentYear = new Date().getFullYear();
          const currentYearShort = currentYear % 100;

          // If year is greater than current year's last 2 digits, assume it's from 1900s
          // Otherwise assume it's from 2000s
          if (parseInt(year) > currentYearShort) {
            year = "19" + year;
          } else {
            year = "20" + year;
          }
        }

        // Pad month and day with leading zeros
        month = month.padStart(2, "0");
        day = day.padStart(2, "0");

        // Return in YYYY-MM-DD format
        return `${year}-${month}-${day}`;
      }
    } catch (error) {
      console.warn(`⚠️ Could not parse date "${excelDate}":`, error);
      return null;
    }
  }

  // Handle Excel serial numbers
  if (
    typeof excelDate === "number" ||
    (typeof excelDate === "string" && !isNaN(excelDate))
  ) {
    const serialNumber =
      typeof excelDate === "string" ? parseFloat(excelDate) : excelDate;

    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(
      excelEpoch.getTime() + serialNumber * 24 * 60 * 60 * 1000
    );

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return null;
};

const importUsers = async (req, res) => {
  console.log("🔄 Import Users - Starting process...");
  console.log("📁 File received:", !!req.file);
  console.log(
    "👤 User info:",
    req.user ? { id: req.user.id, role: req.user.role } : "No user"
  );
  console.log("📋 Headers:", req.headers["content-type"]);

  // Check if file is uploaded
  if (!req.file) {
    console.log("❌ No file uploaded");
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
      details: "Please select a valid Excel file (.xlsx or .xls)",
    });
  }

  console.log("📊 File details:", {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    bufferLength: req.file.buffer?.length,
  });

  try {
    // Validate file type
    const validMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
      "application/octet-stream", // sometimes Excel files come as this
    ];

    if (!validMimeTypes.includes(req.file.mimetype)) {
      console.log("❌ Invalid file type:", req.file.mimetype);
      return res.status(400).json({
        success: false,
        message:
          "Invalid file type. Please upload an Excel file (.xlsx or .xls)",
        receivedType: req.file.mimetype,
      });
    }

    // Parse Excel file
    console.log("📖 Reading Excel file...");
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    console.log("📃 Worksheets found:", workbook.SheetNames);

    if (workbook.SheetNames.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No worksheets found in the Excel file",
      });
    }

    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    console.log("📊 Rows parsed:", rows.length);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No data found in the Excel file",
      });
    }

    // Log first few rows for debugging
    console.log(
      "🔍 Sample data (first 2 rows):",
      JSON.stringify(rows.slice(0, 2), null, 2)
    );

    // Debug: Show all roles found in file
    console.log("🔍 All roles found in file:", [
      ...new Set(rows.map((row) => row.role).filter(Boolean)),
    ]);

    // Process users
    const users = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because Excel rows start at 1 and we have headers

      // Skip empty rows
      if (!row.email && !row.first_name && !row.last_name) {
        console.log(`⏭️ Skipping empty row ${rowNum}`);
        continue;
      }

      // Validate required fields
      if (!row.email) {
        errors.push(`Row ${rowNum}: Email is required`);
        continue;
      }

      if (!row.password) {
        errors.push(`Row ${rowNum}: Password is required`);
        continue;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(row.email)) {
        errors.push(`Row ${rowNum}: Invalid email format - ${row.email}`);
        continue;
      }

      try {
        console.log(`🔐 Hashing password for row ${rowNum}...`);
        const password_hash = await bcrypt.hash(row.password.toString(), 12);

        // FIXED: Map roles to match database constraint
        let userRole = (row.role || "student").toLowerCase().trim();

        // Handle role mapping to match database constraint
        const roleMapping = {
          student: "student",
          teacher: "institute_admin", // Map teacher → institute_admin
          parent: "parent",
          institute_admin: "institute_admin",
          instituteadmin: "institute_admin",
          "institute admin": "institute_admin",
          admin: "institute_admin",
          zone_manager: "institute_admin", // Map zone_manager → institute_admin
          zonemanager: "institute_admin",
          "zone manager": "institute_admin",
          manager: "institute_admin",
          super_admin: "super_admin",
          superadmin: "super_admin",
          "super admin": "super_admin",
          super: "super_admin",
        };

        // Map the role or default to student
        userRole = roleMapping[userRole] || "student";

        // Final validation - only allow database-approved roles
        const validRoles = [
          "student",
          "parent",
          "institute_admin",
          "super_admin",
        ];

        if (!validRoles.includes(userRole)) {
          console.warn(
            `⚠️ Invalid role "${row.role}" in row ${rowNum}, defaulting to "student"`
          );
          userRole = "student";
        }

        console.log(`🎭 Row ${rowNum}: "${row.role}" → "${userRole}"`);

        const user = {
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          email: row.email.toLowerCase().trim(),
          password_hash,
          role: userRole, // Use the mapped role
          phone: row.phone ? Math.abs(row.phone).toString() : null,
          institute_id: row.institute_id ? parseInt(row.institute_id) : null,
          zone_id: row.zone_id ? parseInt(row.zone_id) : null,
          status: row.status || "active",
          date_of_birth: convertExcelDate(row.date_of_birth),
          gender: row.gender || null,
          address: row.address || null,
          created_at: new Date().toISOString(),
        };

        users.push(user);
        console.log(
          `✅ User processed for row ${rowNum}: ${user.email} (role: ${user.role})`
        );
      } catch (hashError) {
        console.error(
          `❌ Error hashing password for row ${rowNum}:`,
          hashError
        );
        errors.push(`Row ${rowNum}: Failed to process password`);
      }
    }

    console.log(
      `📊 Processing complete: ${users.length} valid users, ${errors.length} errors`
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid users found in file",
        errors: errors.slice(0, 10), // Limit to first 10 errors
        totalErrors: errors.length,
      });
    }

    // Check for duplicate emails in the batch
    const emailCounts = {};
    const duplicateEmails = [];

    users.forEach((user, index) => {
      if (emailCounts[user.email]) {
        duplicateEmails.push(
          `Duplicate email in batch: ${user.email} (rows ${
            emailCounts[user.email]
          } and ${index + 2})`
        );
      } else {
        emailCounts[user.email] = index + 2;
      }
    });

    if (duplicateEmails.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Duplicate emails found in the file",
        errors: duplicateEmails,
      });
    }

    // Check for existing emails in database
    console.log("🔍 Checking for existing emails in database...");
    const emailsToCheck = users.map((u) => u.email);
    const { data: existingUsers, error: checkError } = await supabase
      .from("users")
      .select("email")
      .in("email", emailsToCheck);

    if (checkError) {
      console.error("❌ Database check error:", checkError);
      return res.status(500).json({
        success: false,
        message: "Failed to check for existing users",
        error: checkError.message,
      });
    }

    if (existingUsers && existingUsers.length > 0) {
      const existingEmails = existingUsers.map((u) => u.email);
      return res.status(400).json({
        success: false,
        message: "Some email addresses already exist in the system",
        existingEmails: existingEmails,
      });
    }

    // Insert users in batches to avoid hitting limits
    console.log("💾 Inserting users into database...");
    const batchSize = 100; // Supabase has limits on bulk inserts
    const insertedUsers = [];

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      console.log(
        `📦 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          users.length / batchSize
        )} (${batch.length} users)...`
      );

      const { data, error } = await supabase
        .from("users")
        .insert(batch)
        .select("id, email, first_name, last_name, role");

      if (error) {
        console.error("❌ Database insert error:", error);
        return res.status(500).json({
          success: false,
          message: `Database error during batch insert: ${error.message}`,
          details: error.details || error.hint,
          batchNumber: Math.floor(i / batchSize) + 1,
        });
      }

      if (data) {
        insertedUsers.push(...data);
      }
    }

    console.log("✅ Import completed successfully");
    console.log(
      `📊 Final stats: ${insertedUsers.length} users imported, ${errors.length} errors`
    );

    const response = {
      success: true,
      message: `Successfully imported ${insertedUsers.length} users`,
      stats: {
        totalProcessed: rows.length,
        successfulImports: insertedUsers.length,
        errors: errors.length,
        skipped: rows.length - users.length - errors.length,
      },
      data: insertedUsers,
    };

    // Include errors if any (for informational purposes)
    if (errors.length > 0) {
      response.warnings = errors.slice(0, 10); // Limit to first 10 errors
      response.totalWarnings = errors.length;
    }

    res.json(response);
  } catch (err) {
    console.error("❌ Import process error:", err);
    console.error("Stack trace:", err.stack);

    res.status(500).json({
      success: false,
      message: "Internal server error during import process",
      error: err.message,
      details: "Please check the file format and try again",
    });
  }
};

// GET /api/users - Get all users with pagination (EXISTING - ENHANCED)
const getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      search,
      status,
      institute_id,
    } = req.query;

    let query = supabase.from("users").select(
      `
        id, first_name, last_name, email, role, phone,
        status, created_at, last_login, date_of_birth, gender,
        institute_id, zone_id,
        institutes(name),
        zones(name)
      `,
      { count: "exact" }
    );

    // Apply filters
    if (role) {
      query = query.eq("role", role);
    }

    if (status) {
      query = query.eq("status", status);
    }

    if (institute_id) {
      query = query.eq("institute_id", institute_id);
    }

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const {
      data: users,
      error,
      count,
    } = await query.range(from, to).order("created_at", { ascending: false });

    if (error) throw error;

    // Format response to match frontend expectations
    const formattedUsers = users.map((user) => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      institute_name: user.institutes?.name || null,
      zone_name: user.zones?.name || null,
      is_active: user.status === "active",
      last_login: user.last_login,
      created_at: user.created_at,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      institute_id: user.institute_id,
      zone_id: user.zone_id,
    }));

    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        pageSize: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// GET /api/users/stats - Get user statistics (EXISTING)
const getUserStats = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("role, status");

    if (error) throw error;

    const statsByRole = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    const activeUsers = users.filter((u) => u.status === "active").length;

    res.json({
      success: true,
      stats: {
        total_users: users.length,
        active_users: activeUsers,
        by_role: statsByRole,
      },
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// GET /api/users/:id - Get single user by ID (NEW)
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from("users")
      .select(
        `
        id, first_name, last_name, email, role, phone,
        status, created_at, last_login, date_of_birth, gender, address,
        institute_id, zone_id,
        institutes(name),
        zones(name)
      `
      )
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Format response
    const formattedUser = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      institute_name: user.institutes?.name || null,
      zone_name: user.zones?.name || null,
      is_active: user.status === "active",
      last_login: user.last_login,
      created_at: user.created_at,
      date_of_birth: user.date_of_birth,
      gender: user.gender,
      address: user.address,
      institute_id: user.institute_id,
      zone_id: user.zone_id,
    };

    res.json({
      success: true,
      data: formattedUser,
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// POST /api/users - Create new user (NEW)
const createUser = async (req, res) => {
  try {
    // Validation rules
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      first_name,
      last_name,
      email,
      password,
      role,
      phone,
      institute_id,
      zone_id,
      date_of_birth,
      gender,
      address,
    } = req.body;

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Create user
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        first_name,
        last_name,
        email,
        password_hash,
        role,
        phone,
        institute_id: institute_id || null,
        zone_id: zone_id || null,
        date_of_birth: date_of_birth || null,
        gender: gender || null,
        address: address || null,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Create user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create user",
      });
    }

    // Remove password hash from response
    delete newUser.password_hash;

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: newUser,
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// PUT /api/users/:id - Update user (NEW)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name,
      last_name,
      email,
      role,
      phone,
      institute_id,
      zone_id,
      date_of_birth,
      gender,
      address,
      status,
    } = req.body;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("id, email")
      .eq("id", id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If email is being changed, check for duplicates
    if (email && email !== existingUser.email) {
      const { data: emailCheck } = await supabase
        .from("users")
        .select("email")
        .eq("email", email)
        .neq("id", id)
        .single();

      if (emailCheck) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone;
    if (institute_id !== undefined) updateData.institute_id = institute_id;
    if (zone_id !== undefined) updateData.zone_id = zone_id;
    if (date_of_birth !== undefined) updateData.date_of_birth = date_of_birth;
    if (gender !== undefined) updateData.gender = gender;
    if (address !== undefined) updateData.address = address;
    if (status !== undefined) updateData.status = status;

    // Update user
    const { data: updatedUser, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Update user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update user",
      });
    }

    // Remove password hash from response
    delete updatedUser.password_hash;

    res.json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// DELETE /api/users/:id - Delete user (NEW)
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", id)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Prevent deletion of super_admin users
    if (existingUser.role === "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Cannot delete super admin users",
      });
    }

    // Soft delete - set status to inactive instead of hard delete
    const { error } = await supabase
      .from("users")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete user",
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// PUT /api/users/:id/status - Toggle user status (NEW)
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const { data: updatedUser, error } = await supabase
      .from("users")
      .update({
        status: is_active ? "active" : "inactive",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: `User ${is_active ? "activated" : "deactivated"} successfully`,
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// DELETE /api/users/bulk - Bulk delete users (NEW)
const bulkDeleteUsers = async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User IDs array is required",
      });
    }

    // Check for super_admin users in the list
    const { data: users, error: fetchError } = await supabase
      .from("users")
      .select("id, role")
      .in("id", userIds);

    if (fetchError) throw fetchError;

    const superAdmins = users.filter((u) => u.role === "super_admin");
    if (superAdmins.length > 0) {
      return res.status(403).json({
        success: false,
        message: "Cannot delete super admin users",
      });
    }

    // Soft delete - set status to inactive
    const { error } = await supabase
      .from("users")
      .update({
        status: "inactive",
        updated_at: new Date().toISOString(),
      })
      .in("id", userIds);

    if (error) throw error;

    res.json({
      success: true,
      message: `${userIds.length} users deleted successfully`,
    });
  } catch (error) {
    console.error("Bulk delete users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// GET /api/users/export - Export users to CSV (NEW)
const exportUsers = async (req, res) => {
  try {
    const { role, status, institute_id } = req.query;

    let query = supabase.from("users").select(`
        first_name, last_name, email, role, phone,
        status, created_at,
        institutes(name),
        zones(name)
      `);

    // Apply filters
    if (role) query = query.eq("role", role);
    if (status) query = query.eq("status", status);
    if (institute_id) query = query.eq("institute_id", institute_id);

    const { data: users, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;

    // Convert to CSV format
    const csvHeader =
      "First Name,Last Name,Email,Role,Phone,Status,Institute,Zone,Created At\n";
    const csvData = users
      .map(
        (user) =>
          `"${user.first_name || ""}","${user.last_name || ""}","${
            user.email
          }","${user.role}","${user.phone || ""}","${user.status}","${
            user.institutes?.name || ""
          }","${user.zones?.name || ""}","${user.created_at}"`
      )
      .join("\n");

    const csv = csvHeader + csvData;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="users-export-${
        new Date().toISOString().split("T")[0]
      }.csv"`
    );
    res.send(csv);
  } catch (error) {
    console.error("Export users error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Validation middleware for user creation
const validateUserCreation = [
  body("first_name").trim().notEmpty().withMessage("First name is required"),
  body("last_name").trim().notEmpty().withMessage("Last name is required"),
  body("email").isEmail().withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("role")
    .isIn([
      "student",
      "teacher",
      "parent",
      "institute_admin",
      "zone_manager",
      "super_admin",
    ])
    .withMessage("Valid role is required"),
  body("phone")
    .optional()
    .matches(/^[+]?[\d\s\-()]{10,15}$/)
    .withMessage("Valid phone number required (10-15 digits)"),
  body("institute_id")
    .optional()
    .isInt()
    .withMessage("Valid institute ID required"),
  body("zone_id").optional().isInt().withMessage("Valid zone ID required"),
];

module.exports = {
  getAllUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserStatus,
  bulkDeleteUsers,
  exportUsers,
  validateUserCreation,
  importUsers,
};
