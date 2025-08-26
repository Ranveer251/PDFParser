const database = require('../database/connection');
const { v4: uuidv4 } = require('uuid');
const { DOCUMENT_STATUS, CONTENT_TYPES } = require('../utils/constants');
const logger = require('../utils/logger');

class Document {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.filename = data.filename;
    this.originalName = data.originalName;
    this.fileSize = data.fileSize;
    this.mimeType = data.mimeType;
    this.uploadTime = data.uploadTime || new Date().toISOString();
    this.processingStatus = data.processingStatus || DOCUMENT_STATUS.PENDING;
    this.processingError = data.processingError || null;
    this.totalPages = data.totalPages || 0;
    this.totalChunks = data.totalChunks || 0;
    this.metadata = data.metadata || {};
  }

  async save() {
    try {
      const result = await database.run(`
        INSERT OR REPLACE INTO documents (
          id, filename, original_name, file_size, mime_type, 
          upload_time, processing_status, processing_error, 
          total_pages, total_chunks, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        this.id,
        this.filename,
        this.originalName,
        this.fileSize,
        this.mimeType,
        this.uploadTime,
        this.processingStatus,
        this.processingError,
        this.totalPages,
        this.totalChunks,
        JSON.stringify(this.metadata)
      ]);

      logger.info(`Document saved: ${this.id}`);
      return result;
    } catch (error) {
      logger.error(`Error saving document ${this.id}:`, error);
      throw error;
    }
  }

  async updateStatus(status, error = null) {
    try {
      this.processingStatus = status;
      this.processingError = error;

      await database.run(`
        UPDATE documents 
        SET processing_status = ?, processing_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, error, this.id]);

      logger.info(`Document ${this.id} status updated to: ${status}`);
    } catch (err) {
      logger.error(`Error updating document status ${this.id}:`, err);
      throw err;
    }
  }

  static async findById(id) {
    try {
      const row = await database.get('SELECT * FROM documents WHERE id = ?', [id]);
      
      if (!row) {
        return null;
      }

      return new Document({
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
      });
    } catch (error) {
      logger.error(`Error finding document ${id}:`, error);
      throw error;
    }
  }

  static async findAll(limit = 50, offset = 0) {
    try {
      const rows = await database.all(`
        SELECT * FROM documents 
        ORDER BY upload_time DESC 
        LIMIT ? OFFSET ?
      `, [limit, offset]);

      return rows.map(row => new Document({
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
    } catch (error) {
      logger.error('Error finding documents:', error);
      throw error;
    }
  }

  async addChunk(chunkData) {
    try {
      const chunkId = uuidv4();
      
      await database.run(`
        INSERT INTO chunks (
          id, document_id, chunk_type, content, page_number, 
          position_data, ocr_confidence, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        chunkId,
        this.id,
        chunkData.type,
        chunkData.content,
        chunkData.pageNumber,
        JSON.stringify(chunkData.position || {}),
        chunkData.ocrConfidence || null,
        JSON.stringify(chunkData.metadata || {})
      ]);

      // Update total chunks count
      await database.run(`
        UPDATE documents 
        SET total_chunks = (
          SELECT COUNT(*) FROM chunks WHERE document_id = ?
        )
        WHERE id = ?
      `, [this.id, this.id]);

      logger.info(`Chunk added to document ${this.id}: ${chunkId}`);
      return chunkId;
    } catch (error) {
      logger.error(`Error adding chunk to document ${this.id}:`, error);
      throw error;
    }
  }

  async getChunks(type = null, page = null) {
    try {
      let sql = 'SELECT * FROM chunks WHERE document_id = ?';
      const params = [this.id];

      if (type) {
        sql += ' AND chunk_type = ?';
        params.push(type);
      }

      if (page !== null) {
        sql += ' AND page_number = ?';
        params.push(page);
      }

      sql += ' ORDER BY page_number, created_at';

      const rows = await database.all(sql, params);

      return rows.map(row => ({
        id: row.id,
        type: row.chunk_type,
        content: row.content,
        pageNumber: row.page_number,
        position: row.position_data ? JSON.parse(row.position_data) : {},
        ocrConfidence: row.ocr_confidence,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error(`Error getting chunks for document ${this.id}:`, error);
      throw error;
    }
  }

  async delete() {
    try {
      // Delete chunks first (should cascade but being explicit)
      await database.run('DELETE FROM chunks WHERE document_id = ?', [this.id]);
      
      // Delete document
      await database.run('DELETE FROM documents WHERE id = ?', [this.id]);
      
      logger.info(`Document deleted: ${this.id}`);
    } catch (error) {
      logger.error(`Error deleting document ${this.id}:`, error);
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      filename: this.filename,
      originalName: this.originalName,
      fileSize: this.fileSize,
      mimeType: this.mimeType,
      uploadTime: this.uploadTime,
      processingStatus: this.processingStatus,
      processingError: this.processingError,
      totalPages: this.totalPages,
      totalChunks: this.totalChunks,
      metadata: this.metadata
    };
  }
}

module.exports = Document;