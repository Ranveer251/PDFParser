const Tesseract = require('tesseract.js');
const logger = require('../utils/logger');

class OCRService {
  constructor() {
    this.workers = new Map();
    this.maxWorkers = parseInt(process.env.OCR_MAX_WORKERS) || 2;
  }

  async createWorker(workerId = 'default') {
    try {
      if (this.workers.has(workerId)) {
        return this.workers.get(workerId);
      }

      const worker = await Tesseract.createWorker({
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      // Configure OCR parameters for better accuracy
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,!?-:;()[]{}"\'/\\',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '1' // Automatic page segmentation with OSD
      });

      this.workers.set(workerId, worker);
      logger.info(`OCR worker ${workerId} created successfully`);
      
      return worker;
    } catch (error) {
      logger.error(`Failed to create OCR worker ${workerId}:`, error);
      throw error;
    }
  }

  async processImage(imageBuffer, options = {}) {
    const workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const worker = await this.createWorker(workerId);
      
      const startTime = Date.now();
      logger.info(`Starting OCR processing for image (${imageBuffer.length} bytes)`);

      const { data } = await worker.recognize(imageBuffer, {
        rectangle: options.rectangle || undefined
      });

      const processingTime = Date.now() - startTime;
      
      // Clean and validate text
      const cleanedText = this.cleanExtractedText(data.text);
      const confidence = data.confidence || 0;

      logger.info(`OCR processing completed`, {
        workerId,
        processingTime,
        confidence: Math.round(confidence),
        textLength: cleanedText.length,
        originalTextLength: data.text.length
      });

      return {
        text: cleanedText,
        confidence: confidence,
        originalText: data.text,
        processingTime,
        wordCount: data.words?.length || 0,
        symbols: data.symbols?.length || 0,
        bbox: data.bbox || null
      };

    } catch (error) {
      logger.error(`OCR processing failed for worker ${workerId}:`, error);
      throw error;
    } finally {
      // Clean up worker
      await this.terminateWorker(workerId);
    }
  }

  async processMultipleImages(imageBuffers, options = {}) {
    const maxConcurrent = Math.min(imageBuffers.length, this.maxWorkers);
    const results = [];

    logger.info(`Processing ${imageBuffers.length} images with ${maxConcurrent} concurrent workers`);

    // Process images in batches
    for (let i = 0; i < imageBuffers.length; i += maxConcurrent) {
      const batch = imageBuffers.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(async (imageBuffer, index) => {
        try {
          const result = await this.processImage(imageBuffer, options);
          return {
            index: i + index,
            success: true,
            result
          };
        } catch (error) {
          logger.error(`Failed to process image ${i + index}:`, error);
          return {
            index: i + index,
            success: false,
            error: error.message
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      logger.info(`Completed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(imageBuffers.length / maxConcurrent)}`);
    }

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    logger.info(`Batch OCR processing completed: ${successful.length} successful, ${failed.length} failed`);

    return {
      results: results.sort((a, b) => a.index - b.index),
      successful: successful.length,
      failed: failed.length,
      totalProcessed: results.length
    };
  }

  cleanExtractedText(text) {
    if (!text) return '';

    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove common OCR artifacts
      .replace(/[|]/g, 'l')
      .replace(/[0O]/g, match => {
        // Simple heuristic: if surrounded by letters, likely O, else 0
        return /[a-zA-Z]/.test(text.charAt(text.indexOf(match) - 1)) ||
               /[a-zA-Z]/.test(text.charAt(text.indexOf(match) + 1)) ? 'O' : '0';
      })
      // Remove non-printable characters except newlines and tabs
      .replace(/[^\x20-\x7E\n\t]/g, '')
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove leading/trailing whitespace
      .trim();
  }

  async terminateWorker(workerId) {
    try {
      const worker = this.workers.get(workerId);
      if (worker) {
        await worker.terminate();
        this.workers.delete(workerId);
        logger.debug(`OCR worker ${workerId} terminated`);
      }
    } catch (error) {
      logger.error(`Error terminating OCR worker ${workerId}:`, error);
    }
  }

  async terminateAllWorkers() {
    try {
      const terminationPromises = Array.from(this.workers.keys()).map(
        workerId => this.terminateWorker(workerId)
      );
      
      await Promise.all(terminationPromises);
      this.workers.clear();
      logger.info('All OCR workers terminated');
    } catch (error) {
      logger.error('Error terminating OCR workers:', error);
    }
  }

  getWorkerCount() {
    return this.workers.size;
  }

  async healthCheck() {
    try {
      // Create a test worker to verify OCR is working
      const testWorker = await this.createWorker('health_check');
      
      // Create a simple test image buffer (1x1 white pixel PNG)
      const testImageBuffer = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0x57, 0x63, 0xF8, 0x0F, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x5C, 0xCC, 0x5E, 0x27, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82
      ]);

      await testWorker.recognize(testImageBuffer);
      await this.terminateWorker('health_check');
      
      return {
        status: 'healthy',
        activeWorkers: this.workers.size,
        maxWorkers: this.maxWorkers
      };
    } catch (error) {
      logger.error('OCR health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        activeWorkers: this.workers.size,
        maxWorkers: this.maxWorkers
      };
    }
  }
}

// Singleton instance
const ocrService = new OCRService();

module.exports = ocrService;