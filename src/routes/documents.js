const express = require('express');
const documentController = require('../controllers/documentController');
const { uploadMiddleware, cleanupOnError, checkDiskSpace } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { 
  validateDocumentOperation, 
  validateDocumentList, 
  validateUpload 
} = require('../utils/validator');

const router = express.Router();

/**
 * @route   POST /api/documents
 * @desc    Upload a new PDF document for processing
 * @access  Authenticated
 * @body    multipart/form-data with 'pdf' file field
 * @body    Optional: metadata (JSON string)
 */
router.post('/',
  uploadLimiter,
  checkDiskSpace,
  uploadMiddleware,
  cleanupOnError,
  validateUpload,
  documentController.uploadDocument
);

/**
 * @route   GET /api/documents
 * @desc    List all documents with filtering and pagination
 * @access  Authenticated
 * @query   page, limit, status, sortBy, sortOrder, fromDate, toDate
 */
router.get('/',
  validateDocumentList,
  documentController.listDocuments
);

/**
 * @route   GET /api/documents/:id
 * @desc    Get document details by ID
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.get('/:id',
  validateDocumentOperation,
  documentController.getDocument
);

/**
 * @route   GET /api/documents/:id/status
 * @desc    Get document processing status
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.get('/:id/status',
  validateDocumentOperation,
  documentController.getDocumentStatus
);

/**
 * @route   GET /api/documents/:id/content
 * @desc    Get document content/chunks with filtering
 * @access  Authenticated
 * @params  id - Document UUID
 * @query   type, page, limit, offset
 */
router.get('/:id/content',
  validateDocumentOperation,
  documentController.getDocumentContent
);

/**
 * @route   POST /api/documents/:id/reprocess
 * @desc    Reprocess a document (queue for processing again)
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.post('/:id/reprocess',
  validateDocumentOperation,
  documentController.reprocessDocument
);

/**
 * @route   DELETE /api/documents/:id
 * @desc    Delete a document and all associated data
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.delete('/:id',
  validateDocumentOperation,
  documentController.deleteDocument
);

module.exports = router;