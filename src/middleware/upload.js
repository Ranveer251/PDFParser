const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { FILE_LIMITS, HTTP_STATUS, ERROR_CODES } = require('../utils/constants');

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create subdirectory by date for organization
    const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const fullPath = path.join(uploadDir, dateDir);
    
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: UUID + timestamp + original extension
    const uniqueId = uuidv4();
    const timestamp = Date.now();
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${uniqueId}_${timestamp}${extension}`;
    
    // Store filename in request for later use
    req.generatedFilename = filename;
    req.uploadPath = req.file?.destination || path.join(uploadDir, new Date().toISOString().split('T')[0]);
    
    cb(null, filename);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Check file type
  if (!FILE_LIMITS.ALLOWED_TYPES.includes(file.mimetype)) {
    logger.warn('File upload rejected: Invalid file type', {
      originalName: file.originalname,
      mimeType: file.mimetype,
      ip: req.ip
    });
    
    const error = new Error('Only PDF files are allowed');
    error.code = ERROR_CODES.INVALID_FILE;
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
    return cb(error, false);
  }

  // Check file extension as additional validation
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf') {
    logger.warn('File upload rejected: Invalid file extension', {
      originalName: file.originalname,
      extension: ext,
      ip: req.ip
    });
    
    const error = new Error('File must have .pdf extension');
    error.code = ERROR_CODES.INVALID_FILE;
    error.statusCode = HTTP_STATUS.BAD_REQUEST;
    return cb(error, false);
  }

  // Log successful file validation
  logger.info('File upload validated successfully', {
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  });

  cb(null, true);
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: FILE_LIMITS.MAX_SIZE,
    files: 1 // Only allow single file upload
  }
});

// Enhanced upload middleware with better error handling
const uploadMiddleware = (req, res, next) => {
  const singleUpload = upload.single('pdf');
  
  singleUpload(req, res, (err) => {
    if (err) {
      logger.error('File upload error:', {
        error: err.message,
        code: err.code,
        originalName: req.file?.originalname,
        ip: req.ip
      });

      // Handle specific multer errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: `File too large. Maximum size is ${Math.round(FILE_LIMITS.MAX_SIZE / (1024 * 1024))}MB`,
          code: ERROR_CODES.INVALID_FILE
        });
      }

      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Unexpected field name. Use "pdf" as the field name',
          code: ERROR_CODES.INVALID_FILE
        });
      }

      if (err.code === ERROR_CODES.INVALID_FILE) {
        return res.status(err.statusCode || HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: err.message,
          code: ERROR_CODES.INVALID_FILE
        });
      }

      // Generic upload error
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'File upload failed',
        code: ERROR_CODES.INVALID_FILE,
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }

    // Validate that file was uploaded
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: 'No file uploaded. Please include a PDF file in the "pdf" field',
        code: ERROR_CODES.INVALID_FILE
      });
    }

    // Add file metadata to request
    req.fileMetadata = {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
      path: req.file.path,
      uploadTime: new Date().toISOString()
    };

    logger.info('File uploaded successfully', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      path: req.file.path,
      ip: req.ip
    });

    next();
  });
};

// Cleanup function to remove uploaded file
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Cleaned up file: ${filePath}`);
    }
  } catch (error) {
    logger.error(`Failed to cleanup file ${filePath}:`, error);
  }
};

// Middleware to cleanup file on error
const cleanupOnError = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // If response is an error and we have a file, clean it up
    if (res.statusCode >= 400 && req.fileMetadata?.path) {
      cleanupFile(req.fileMetadata.path);
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

// File validation helpers
const validateFileExists = (filePath) => {
  return fs.existsSync(filePath);
};

const getFileStats = (filePath) => {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    logger.error(`Error getting file stats for ${filePath}:`, error);
    return null;
  }
};

// Disk space check middleware
const checkDiskSpace = (req, res, next) => {
  try {
    const stats = fs.statSync(uploadDir);
    // This is a basic check - in production, you might want more sophisticated disk space monitoring
    logger.debug('Upload directory stats:', {
      path: uploadDir,
      exists: fs.existsSync(uploadDir)
    });
    next();
  } catch (error) {
    logger.error('Disk space check failed:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Storage system unavailable',
      code: 'STORAGE_ERROR'
    });
  }
};

module.exports = {
  uploadMiddleware,
  cleanupFile,
  cleanupOnError,
  validateFileExists,
  getFileStats,
  checkDiskSpace,
  uploadDir
};