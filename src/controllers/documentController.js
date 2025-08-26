const fs = require('fs');
const Document = require('../models/Document');
const queueManager = require('../config/queue');
const indexService = require('../services/indexService');
const { cleanupFile } = require('../middleware/upload');
const logger = require('../utils/logger');
const { HTTP_STATUS, DOCUMENT_STATUS } = require('../utils/constants');

class DocumentController {
  /**
   * Upload and process a new PDF document
   */
  async uploadDocument(req, res) {
    let document = null;
    
    try {
      const { fileMetadata } = req;
      const metadata = req.body.metadata || {};

      logger.info('Processing document upload', {
        originalName: fileMetadata.originalName,
        size: fileMetadata.size,
        ip: req.ip
      });

      // Create document record
      document = new Document({
        filename: fileMetadata.filename,
        originalName: fileMetadata.originalName,
        fileSize: fileMetadata.size,
        mimeType: fileMetadata.mimeType,
        metadata: {
          ...metadata,
          uploadPath: fileMetadata.path,
          uploadIp: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      // Save to database
      await document.save();

      const img = fs.readFileSync("/Users/ranveer/Documents/LLD/PDFParser/images/imageWithText.jpeg");

      const table = {
        caption: "System Design Components",
        headers: ["Component", "Purpose", "Example"],
        rows: [
          ["Load Balancer", "Distributes traffic across servers", "Nginx, HAProxy"],
          ["Cache", "Stores frequently accessed data", "Redis, Memcached"],
          ["Database", "Persistent data storage", "PostgreSQL, MongoDB"],
          ["Message Queue", "Asynchronous task processing", "RabbitMQ, Kafka"],
          ["Search Engine", "repair workflow Full-text search & ranking", "Elasticsearch, Meilisearch"]
        ]
      };

      // Queue for processing
      // Note: In a real scenario, you'd have the parsed PDF data from an external parser
      // For now, we'll simulate the parsed data structure
      const mockParsedData = {
        paragraphs: [
          {
            content: `Document ${document.originalName} uploaded for processing. Led end-to-end development of unreferenced chunk detection service that eliminated 1,650+ reconciler blocking tickets over 6 months, achieving 99% accuracy in identifying orphaned data chunks and preventing future data durability issues through proactive regression detection.
• Architected and implemented automated drive repair workflow for unified storage backend (object/block/file), replacing manual processes with scheduler-based self-healing system that automatically detects 98% of drive issues, routes for recycling, and reintegrates repaired drives.`,
            pageNumber: 1,
            position: { x: 0, y: 0, width: 100, height: 20 }
          }
        ],
        images: [img],
        tables: [table]
      };

      await queueManager.addJob('document', {
        documentId: document.id,
        parsedData: mockParsedData,
        filePath: fileMetadata.path
      }, {
        priority: 1,
        attempts: 3
      });

      logger.info('Document queued for processing', {
        documentId: document.id,
        originalName: document.originalName
      });

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message: 'Document uploaded and queued for processing',
        data: {
          document: document.toJSON(),
          estimatedProcessingTime: '2-5 minutes'
        }
      });

    } catch (error) {
      logger.error('Document upload failed:', error);

      // Cleanup uploaded file if document creation failed
      if (req.fileMetadata?.path) {
        cleanupFile(req.fileMetadata.path);
      }

      // Update document status if it was created
      if (document) {
        try {
          await document.updateStatus(DOCUMENT_STATUS.FAILED, error.message);
        } catch (updateError) {
          logger.error('Failed to update document status after upload error:', updateError);
        }
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Document upload failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get document by ID
   */
  async getDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      res.json({
        success: true,
        data: {
          document: document.toJSON()
        }
      });

    } catch (error) {
      logger.error('Failed to get document:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve document'
      });
    }
  }

  /**
   * Get document status
   */
  async getDocumentStatus(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Get processing progress if available
      let processingInfo = {
        status: document.processingStatus,
        error: document.processingError
      };

      // If processing, try to get queue information
      if (document.processingStatus === DOCUMENT_STATUS.PROCESSING) {
        try {
          const queueStats = await queueManager.getQueueStats('document');
          processingInfo.queuePosition = queueStats.active + queueStats.waiting;
        } catch (queueError) {
          logger.warn('Failed to get queue stats:', queueError);
        }
      }

      res.json({
        success: true,
        data: {
          documentId: document.id,
          filename: document.originalName,
          uploadTime: document.uploadTime,
          processing: processingInfo,
          totalPages: document.totalPages,
          totalChunks: document.totalChunks
        }
      });

    } catch (error) {
      logger.error('Failed to get document status:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve document status'
      });
    }
  }

  /**
   * Get document content/chunks
   */
  async getDocumentContent(req, res) {
    try {
      const { id } = req.params;
      const { type, page, limit = 50, offset = 0 } = req.query;

      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      if (document.processingStatus !== DOCUMENT_STATUS.COMPLETED) {
        return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
          success: false,
          error: `Document is not ready. Status: ${document.processingStatus}`
        });
      }

      // Get chunks with filtering
      const chunks = await document.getChunks(type, page ? parseInt(page) : null);
      
      // Apply pagination
      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedChunks = chunks.slice(startIndex, endIndex);

      res.json({
        success: true,
        data: {
          document: {
            id: document.id,
            filename: document.originalName,
            totalPages: document.totalPages,
            totalChunks: document.totalChunks
          },
          chunks: paginatedChunks,
          pagination: {
            offset: startIndex,
            limit: parseInt(limit),
            total: chunks.length,
            hasMore: endIndex < chunks.length
          },
          filters: {
            type: type || null,
            page: page ? parseInt(page) : null
          }
        }
      });

    } catch (error) {
      logger.error('Failed to get document content:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve document content'
      });
    }
  }

  /**
   * List all documents with filtering and pagination
   */
  async listDocuments(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status, 
        sortBy = 'uploadTime', 
        sortOrder = 'desc',
        fromDate,
        toDate
      } = req.query;

      const offset = (page - 1) * limit;

      // Build query conditions
      let whereConditions = [];
      let params = [];

      if (status) {
        whereConditions.push('processing_status = ?');
        params.push(status);
      }

      if (fromDate) {
        whereConditions.push('upload_time >= ?');
        params.push(fromDate);
      }

      if (toDate) {
        whereConditions.push('upload_time <= ?');
        params.push(toDate);
      }

      const whereClause = whereConditions.length > 0 ? 
        'WHERE ' + whereConditions.join(' AND ') : '';

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM documents ${whereClause}`;
      const countResult = await require('../database/connection').get(countQuery, params);
      const total = countResult.total;

      // Get documents
      const documentsQuery = `
        SELECT * FROM documents 
        ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;
      
      const rows = await require('../database/connection').all(
        documentsQuery, 
        [...params, limit, offset]
      );

      const documents = rows.map(row => new Document({
        id: row.id,
        filename: row.filename,
        originalName: row.original_name,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        uploadTime: row.upload_time,
        processingStatus: row.processing_status,
        processingError: row.processing_error,
        totalPages: row.total_pages,
        totalChunks: row.total_chunks,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      res.json({
        success: true,
        data: {
          documents: documents.map(doc => doc.toJSON()),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            hasNext: offset + limit < total,
            hasPrev: page > 1
          },
          filters: {
            status,
            fromDate,
            toDate,
            sortBy,
            sortOrder
          }
        }
      });

    } catch (error) {
      logger.error('Failed to list documents:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve documents'
      });
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Delete search index
      try {
        await indexService.deleteDocumentIndex(id);
      } catch (indexError) {
        logger.warn('Failed to delete search index:', indexError);
      }

      // Delete file from disk
      if (document.metadata?.uploadPath) {
        cleanupFile(document.metadata.uploadPath);
      }

      // Delete from database
      await document.delete();

      logger.info('Document deleted successfully', {
        documentId: id,
        filename: document.originalName
      });

      res.json({
        success: true,
        message: 'Document deleted successfully',
        data: {
          documentId: id
        }
      });

    } catch (error) {
      logger.error('Failed to delete document:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to delete document'
      });
    }
  }

  /**
   * Reprocess a document
   */
  async reprocessDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Check if document can be reprocessed
      if (document.processingStatus === DOCUMENT_STATUS.PROCESSING) {
        return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
          success: false,
          error: 'Document is already being processed'
        });
      }

      // Reset document status
      await document.updateStatus(DOCUMENT_STATUS.PENDING);

      // Queue for reprocessing
      const mockParsedData = {
        paragraphs: [
          {
            content: `Document ${document.originalName} reprocessing`,
            pageNumber: 1,
            position: { x: 0, y: 0, width: 100, height: 20 }
          }
        ],
        images: [],
        tables: []
      };

      await queueManager.addJob('document', {
        documentId: document.id,
        parsedData: mockParsedData,
        filePath: document.metadata.uploadPath
        }, {
        priority: 1,
        attempts: 3
      });
        logger.info('Document queued for reprocessing', {
            documentId: document.id,
            originalName: document.originalName
        });
        res.json({
            success: true,
            message: 'Document reprocessing queued',
            data: {
                document: document.toJSON(),
                estimatedProcessingTime: '2-5 minutes'
            }
        });
    } catch (error) {
      logger.error('Failed to reprocess document:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to reprocess document'
      });
    }
  }
}

module.exports = new DocumentController();