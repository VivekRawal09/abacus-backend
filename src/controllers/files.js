const { supabase } = require('../config/database');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class FilesController {

  // 1. POST /api/files/upload - Upload single file
  static async uploadFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const {
        entity_type = 'general',
        entity_id = null,
        file_category = 'document',
        is_public = false
      } = req.body;

      const file = req.file;
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      
      // ✅ UPDATED: Organize files by user ID for privacy
      const filePath = `uploads/${req.user.id}/${entity_type}/${fileName}`;

      // Upload to Supabase Storage (private bucket)
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('abacus-files')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload file to storage'
        });
      }

      // ✅ UPDATED: Don't get public URL since bucket is private
      // Files will be accessed via download endpoint with proper authentication

      // Save file metadata to database
      const { data: fileRecord, error: dbError } = await supabase
        .from('file_uploads')
        .insert([{
          entity_type,
          entity_id,
          file_type: file.mimetype,
          file_category,
          original_filename: file.originalname,
          stored_filename: fileName,
          file_path: filePath,
          file_url: null, // ✅ UPDATED: No direct URL for private files
          file_size_bytes: file.size,
          mime_type: file.mimetype,
          uploaded_by: req.user.id,
          is_public: Boolean(is_public),
          metadata: {
            upload_source: 'api',
            original_name: file.originalname,
            upload_timestamp: new Date().toISOString()
          }
        }])
        .select()
        .single();

      if (dbError) {
        // Cleanup storage if DB insert fails
        await supabase.storage.from('abacus-files').remove([filePath]);
        throw dbError;
      }

      res.status(201).json({
        success: true,
        data: {
          file_id: fileRecord.id,
          original_name: fileRecord.original_filename,
          file_size: fileRecord.file_size_bytes,
          file_type: fileRecord.file_type,
          file_url: null, // ✅ UPDATED: No direct URL
          download_url: `/api/files/${fileRecord.id}/download`,
          uploaded_at: fileRecord.created_at
        },
        message: 'File uploaded successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Upload file error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload file'
      });
    }
  }

  // 2. GET /api/files/:id - Get file details
  static async getFileDetails(req, res) {
    try {
      const { id } = req.params;

      let query = supabase
        .from('file_uploads')
        .select('*')
        .eq('id', id)
        .eq('is_active', true);

      // ✅ UPDATED: Enhanced access control for private files
      if (!['super_admin', 'zone_manager', 'institute_admin'].includes(req.user.role)) {
        // Users can only see their own files or public files
        query = query.or(`uploaded_by.eq.${req.user.id},is_public.eq.true`);
      }

      const { data: file, error } = await query.single();

      if (error || !file) {
        return res.status(404).json({
          success: false,
          message: 'File not found'
        });
      }

      res.json({
        success: true,
        data: {
          id: file.id,
          original_name: file.original_filename,
          file_size: file.file_size_bytes,
          file_type: file.file_type,
          file_category: file.file_category,
          entity_type: file.entity_type,
          is_public: file.is_public,
          uploaded_at: file.created_at,
          uploaded_by: file.uploaded_by,
          download_url: `/api/files/${file.id}/download`,
          metadata: file.metadata
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get file details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch file details'
      });
    }
  }

  // 3. DELETE /api/files/:id - Delete file
  static async deleteFile(req, res) {
    try {
      const { id } = req.params;

      // Check if file exists and user has permission
      let query = supabase
        .from('file_uploads')
        .select('id, file_path, uploaded_by')
        .eq('id', id)
        .eq('is_active', true);

      // Users can only delete their own files, admins can delete any
      if (!['super_admin', 'zone_manager', 'institute_admin'].includes(req.user.role)) {
        query = query.eq('uploaded_by', req.user.id);
      }

      const { data: file, error: fetchError } = await query.single();

      if (fetchError || !file) {
        return res.status(404).json({
          success: false,
          message: 'File not found or access denied'
        });
      }

      // Soft delete in database
      const { error: deleteError } = await supabase
        .from('file_uploads')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (deleteError) throw deleteError;

      // Delete from storage (optional - you might want to keep for recovery)
      await supabase.storage
        .from('abacus-files')
        .remove([file.file_path]);

      res.json({
        success: true,
        message: 'File deleted successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete file'
      });
    }
  }

  // 4. GET /api/files/:id/download - Download file (UPDATED FOR PRIVATE BUCKET)
  static async downloadFile(req, res) {
    try {
      const { id } = req.params;

      // ✅ UPDATED: Enhanced access control check
      let query = supabase
        .from('file_uploads')
        .select('*')
        .eq('id', id)
        .eq('is_active', true);

      // Access control for private files
      if (!['super_admin', 'zone_manager', 'institute_admin'].includes(req.user.role)) {
        query = query.or(`uploaded_by.eq.${req.user.id},is_public.eq.true`);
      }

      const { data: file, error } = await query.single();

      if (error || !file) {
        return res.status(404).json({
          success: false,
          message: 'File not found or access denied'
        });
      }

      // ✅ UPDATED: Create signed URL for secure temporary access
      const { data: signedUrlData, error: urlError } = await supabase.storage
        .from('abacus-files')
        .createSignedUrl(file.file_path, 3600); // 1 hour expiry

      if (urlError) {
        console.error('Signed URL error:', urlError);
        return res.status(500).json({
          success: false,
          message: 'Failed to generate download URL'
        });
      }

      // ✅ OPTION 1: Redirect to signed URL (simpler)
      res.redirect(signedUrlData.signedUrl);

      // ✅ OPTION 2: Proxy the file (uncomment this and comment redirect above for more control)
      /*
      // Download file data
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('abacus-files')
        .download(file.file_path);

      if (downloadError) {
        console.error('Storage download error:', downloadError);
        return res.status(404).json({
          success: false,
          message: 'File not found in storage'
        });
      }

      // Convert blob to buffer
      const buffer = await fileData.arrayBuffer();

      // Set response headers
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Content-Length', file.file_size_bytes);
      res.setHeader('Content-Disposition', `attachment; filename="${file.original_filename}"`);
      
      // Send file through your server (more secure but uses bandwidth)
      res.send(Buffer.from(buffer));
      */

    } catch (error) {
      console.error('Download file error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to download file'
      });
    }
  }

  // 5. POST /api/files/bulk-upload - Bulk file upload
  static async bulkUpload(req, res) {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }

      const {
        entity_type = 'general',
        entity_id = null,
        file_category = 'document',
        is_public = false
      } = req.body;

      const uploadResults = [];
      const errors = [];

      // Process each file
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const fileExtension = path.extname(file.originalname);
          const fileName = `${uuidv4()}${fileExtension}`;
          
          // ✅ UPDATED: Organize by user ID
          const filePath = `uploads/${req.user.id}/${entity_type}/${fileName}`;

          // Upload to storage
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('abacus-files')
            .upload(filePath, file.buffer, {
              contentType: file.mimetype,
              upsert: false
            });

          if (uploadError) throw uploadError;

          // Save to database (no direct URL for private files)
          const { data: fileRecord, error: dbError } = await supabase
            .from('file_uploads')
            .insert([{
              entity_type,
              entity_id,
              file_type: file.mimetype,
              file_category,
              original_filename: file.originalname,
              stored_filename: fileName,
              file_path: filePath,
              file_url: null, // ✅ UPDATED: No direct URL
              file_size_bytes: file.size,
              mime_type: file.mimetype,
              uploaded_by: req.user.id,
              is_public: Boolean(is_public),
              metadata: {
                upload_source: 'bulk_api',
                batch_index: i,
                upload_timestamp: new Date().toISOString()
              }
            }])
            .select()
            .single();

          if (dbError) throw dbError;

          uploadResults.push({
            file_id: fileRecord.id,
            original_name: fileRecord.original_filename,
            status: 'success',
            download_url: `/api/files/${fileRecord.id}/download`
          });

        } catch (error) {
          console.error(`Bulk upload error for file ${i}:`, error);
          errors.push({
            file_name: file.originalname,
            error: error.message
          });
        }
      }

      res.status(201).json({
        success: true,
        data: {
          uploaded_files: uploadResults,
          total_uploaded: uploadResults.length,
          total_failed: errors.length,
          errors: errors.length > 0 ? errors : undefined
        },
        message: `Bulk upload completed. ${uploadResults.length} files uploaded successfully`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Bulk upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process bulk upload'
      });
    }
  }
}

module.exports = FilesController;