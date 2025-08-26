const natural = require('natural');
const Document = require('../models/Document');
const ocrService = require('./ocrService');
const indexService = require('./indexService');
const logger = require('../utils/logger');
const { DOCUMENT_STATUS, CONTENT_TYPES } = require('../utils/constants');

class ETLService {
  constructor() {
    this.stemmer = natural.PorterStemmer;
    this.tokenizer = new natural.WordTokenizer();
  }

  async processDocument(documentId, parsedData) {
    let document = null;
    
    try {
      // Load document from database
      document = await Document.findById(documentId);
      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      // Update status to processing
      await document.updateStatus(DOCUMENT_STATUS.PROCESSING);

      logger.info(`Starting ETL processing for document: ${documentId}`);

      // Extract and process content
      const processedChunks = await this.extractAndProcessContent(parsedData);

      // Update document metadata
      document.totalPages = this.calculateTotalPages(processedChunks);
      await document.save();

      // Store processed chunks in database
      const chunkIds = await this.storeChunks(document, processedChunks);

      // Create search index
      await indexService.createDocumentIndex(documentId);
      
      // Index content for search
      await indexService.indexDocumentChunks(documentId, processedChunks);

      // Update document status to completed
      await document.updateStatus(DOCUMENT_STATUS.COMPLETED);

      const result = {
        documentId,
        totalChunks: processedChunks.length,
        totalPages: document.totalPages,
        chunksByType: this.getChunkStatsByType(processedChunks),
        processingTime: Date.now() - new Date(document.uploadTime).getTime()
      };

      logger.info(`ETL processing completed for document: ${documentId}`, result);
      
      return result;

    } catch (error) {
      logger.error(`ETL processing failed for document: ${documentId}`, error);
      
      if (document) {
        await document.updateStatus(DOCUMENT_STATUS.FAILED, error.message);
      }
      
      throw error;
    }
  }

  async extractAndProcessContent(parsedData) {
    const processedChunks = [];

    try {
      // Process paragraphs
      if (parsedData.paragraphs && Array.isArray(parsedData.paragraphs)) {
        const paragraphChunks = await this.processParagraphs(parsedData.paragraphs);
        processedChunks.push(...paragraphChunks);
      }

      // Process images with OCR
      if (parsedData.images && Array.isArray(parsedData.images)) {
        const imageChunks = await this.processImages(parsedData.images);
        processedChunks.push(...imageChunks);
      }

      // Process tables
      if (parsedData.tables && Array.isArray(parsedData.tables)) {
        const tableChunks = await this.processTables(parsedData.tables);
        processedChunks.push(...tableChunks);
      }

      logger.info(`Content extraction completed: ${processedChunks.length} chunks processed`);
      
      return processedChunks;

    } catch (error) {
      logger.error('Content extraction failed:', error);
      throw error;
    }
  }

  async processParagraphs(paragraphs) {
    const chunks = [];

    for (const paragraph of paragraphs) {
      try {
        // Clean and normalize text
        const cleanedText = this.cleanText(paragraph.content || paragraph.text || '');
        
        if (!cleanedText || cleanedText.length < 10) {
          continue; // Skip very short or empty paragraphs
        }

        // Extract text features
        const features = this.extractTextFeatures(cleanedText);

        const chunk = {
          id: this.generateChunkId(),
          type: CONTENT_TYPES.PARAGRAPH,
          content: cleanedText,
          pageNumber: paragraph.pageNumber || paragraph.page || 1,
          position: paragraph.position || paragraph.bbox || {},
          metadata: {
            originalLength: (paragraph.content || paragraph.text || '').length,
            cleanedLength: cleanedText.length,
            ...features,
            fontInfo: paragraph.fontInfo || null,
            style: paragraph.style || null
          }
        };

        chunks.push(chunk);

      } catch (error) {
        logger.error('Error processing paragraph:', error);
        // Continue processing other paragraphs
      }
    }

    logger.info(`Processed ${chunks.length} paragraph chunks`);
    return chunks;
  }

  async processImages(images) {
    const chunks = [];

    logger.info(`Starting OCR processing for ${images.length} images`);

    for (const image of images) {
      try {
        let extractedText = '';
        let ocrConfidence = 0;

        // Perform OCR if image data is available
        if (image.data || image.buffer) {
          const imageBuffer = image.data || image.buffer;
          const ocrResult = await ocrService.processImage(imageBuffer);
          
          extractedText = ocrResult.text;
          ocrConfidence = ocrResult.confidence;
        }

        // Only create chunk if we have meaningful text
        if (extractedText && extractedText.length > 5) {
          const features = this.extractTextFeatures(extractedText);

          const chunk = {
            id: this.generateChunkId(),
            type: CONTENT_TYPES.IMAGE,
            content: extractedText,
            pageNumber: image.pageNumber || image.page || 1,
            position: image.position || image.bbox || {},
            ocrConfidence,
            metadata: {
              originalImageSize: imageBuffer ? imageBuffer.length : 0,
              extractedTextLength: extractedText.length,
              ...features,
              imageFormat: image.format || 'unknown',
              dimensions: image.dimensions || null
            }
          };

          chunks.push(chunk);
        }

      } catch (error) {
        logger.error('Error processing image:', error);
        // Continue processing other images
      }
    }

    logger.info(`Processed ${chunks.length} image chunks with OCR`);
    return chunks;
  }

  async processTables(tables) {
    const chunks = [];

    for (const table of tables) {
      try {
        // Convert table structure to searchable text
        const tableText = this.convertTableToText(table);
        
        if (!tableText || tableText.length < 10) {
          continue; // Skip empty or very small tables
        }

        const features = this.extractTextFeatures(tableText);

        const chunk = {
          id: this.generateChunkId(),
          type: CONTENT_TYPES.TABLE,
          content: tableText,
          pageNumber: table.pageNumber || table.page || 1,
          position: table.position || table.bbox || {},
          metadata: {
            rowCount: table.rows ? table.rows.length : 0,
            columnCount: table.headers ? table.headers.length : 0,
            tableStructure: this.extractTableStructure(table),
            ...features
          }
        };

        chunks.push(chunk);

      } catch (error) {
        logger.error('Error processing table:', error);
        // Continue processing other tables
      }
    }

    logger.info(`Processed ${chunks.length} table chunks`);
    return chunks;
  }

  cleanText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove special characters that might break search
      .replace(/[^\w\s.,!?;:()\-\[\]{}'"\/\\]/g, '')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Remove multiple consecutive punctuation
      .replace(/([.,!?;:]){2,}/g, '$1')
      // Trim whitespace
      .trim();
  }

  extractTextFeatures(text) {
    if (!text) {
      return {};
    }

    const tokens = this.tokenizer.tokenize(text.toLowerCase());
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    return {
      wordCount: tokens ? tokens.length : 0,
      sentenceCount: sentences.length,
      characterCount: text.length,
      avgWordsPerSentence: sentences.length > 0 ? Math.round(tokens.length / sentences.length) : 0,
      containsNumbers: /\d/.test(text),
      containsCapitals: /[A-Z]/.test(text),
      language: 'en' // Could be enhanced with language detection
    };
  }

  convertTableToText(table) {
    try {
      let text = '';

      // Add headers if available
      if (table.headers && Array.isArray(table.headers)) {
        text += 'Headers: ' + table.headers.join(', ') + '\n';
      }

      // Add rows
      if (table.rows && Array.isArray(table.rows)) {
        table.rows.forEach((row, index) => {
          if (Array.isArray(row)) {
            text += `Row ${index + 1}: ` + row.join(', ') + '\n';
          } else if (typeof row === 'object') {
            text += `Row ${index + 1}: ` + Object.values(row).join(', ') + '\n';
          }
        });
      }

      // Add caption if available
      if (table.caption) {
        text += 'Caption: ' + table.caption + '\n';
      }

      return text.trim();
    } catch (error) {
      logger.error('Error converting table to text:', error);
      return '';
    }
  }

  extractTableStructure(table) {
    return {
      hasHeaders: !!(table.headers && table.headers.length > 0),
      hasCaption: !!table.caption,
      isNumeric: table.rows ? table.rows.some(row => 
        Array.isArray(row) && row.some(cell => !isNaN(parseFloat(cell)))
      ) : false
    };
  }

  async storeChunks(document, chunks) {
    const chunkIds = [];

    for (const chunk of chunks) {
      try {
        const chunkId = await document.addChunk(chunk);
        chunkIds.push(chunkId);
      } catch (error) {
        logger.error('Error storing chunk:', error);
        // Continue storing other chunks
      }
    }

    logger.info(`Stored ${chunkIds.length} chunks in database`);
    return chunkIds;
  }

  calculateTotalPages(chunks) {
    if (!chunks || chunks.length === 0) {
      return 0;
    }

    return Math.max(...chunks.map(chunk => chunk.pageNumber || 1));
  }

  getChunkStatsByType(chunks) {
    const stats = {};
    
    Object.values(CONTENT_TYPES).forEach(type => {
      stats[type] = chunks.filter(chunk => chunk.type === type).length;
    });

    return stats;
  }

  generateChunkId() {
    return `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async healthCheck() {
    try {
      // Test text processing
      const testText = "This is a test paragraph for health check.";
      const features = this.extractTextFeatures(testText);
      
      if (!features.wordCount || features.wordCount !== 9) {
        throw new Error('Text feature extraction failed');
      }

      // Test OCR service
      const ocrHealth = await ocrService.healthCheck();
      if (ocrHealth.status !== 'healthy') {
        throw new Error('OCR service is unhealthy');
      }

      // Test index service
      const indexHealth = await indexService.healthCheck();
      if (indexHealth.status !== 'healthy') {
        throw new Error('Index service is unhealthy');
      }

      return {
        status: 'healthy',
        services: {
          ocr: ocrHealth,
          index: indexHealth
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('ETL service health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Singleton instance
const etlService = new ETLService();

module.exports = etlService;