const etlService = require('../services/etlService');
const Document = require('../models/Document');
const logger = require('../utils/logger');
const { DOCUMENT_STATUS } = require('../utils/constants');

/**
 * Background job processor for document processing
 */
async function processDocumentJob(job) {
  const { documentId, parsedData } = job.data;
  const startTime = Date.now();

  try {
    logger.info(`Starting document processing job`, {
      jobId: job.id,
      documentId,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts
    });

    // Update job progress
    await job.progress(10);

    // Validate input data
    if (!documentId) {
      throw new Error('Document ID is required');
    }

    if (!parsedData) {
      throw new Error('Parsed data is required');
    }

    // Check if document exists
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Check if document is in correct state
    if (document.processingStatus === DOCUMENT_STATUS.COMPLETED) {
      logger.warn(`Document ${documentId} is already processed, skipping`);
      return {
        documentId,
        status: 'already_processed',
        processingTime: 0
      };
    }

    await job.progress(20);

    // Process the document using ETL service
    const result = await etlService.processDocument(documentId, parsedData);

    await job.progress(100);

    const processingTime = Date.now() - startTime;

    logger.info(`Document processing job completed`, {
      jobId: job.id,
      documentId,
      processingTime,
      totalChunks: result.totalChunks,
      totalPages: result.totalPages
    });

    return {
      ...result,
      jobId: job.id,
      processingTime,
      status: 'completed'
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error(`Document processing job failed`, {
      jobId: job.id,
      documentId,
      error: error.message,
      stack: error.stack,
      processingTime,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts
    });

    // Update document status if it's the final attempt
    if (job.attemptsMade + 1 >= job.opts.attempts) {
      try {
        const document = await Document.findById(documentId);
        if (document) {
          await document.updateStatus(DOCUMENT_STATUS.FAILED, error.message);
        }
      } catch (updateError) {
        logger.error(`Failed to update document status after job failure:`, updateError);
      }
    }

    throw error;
  }
}

/**
 * Job event handlers for monitoring and logging
 */
function setupJobEventHandlers(queue) {
  queue.process('processDocument', async (job) => {
    return await processDocumentJob(job);
  });

  // Handle job events
  queue.on('completed', (job, result) => {
    logger.info(`Job ${job.id} completed successfully`, {
      documentId: result.documentId,
      processingTime: result.processingTime,
      totalChunks: result.totalChunks
    });
  });

  queue.on('failed', (job, error) => {
    logger.error(`Job ${job.id} failed`, {
      documentId: job.data.documentId,
      error: error.message,
      attempt: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      willRetry: job.attemptsMade < job.opts.attempts
    });
  });

  queue.on('progress', (job, progress) => {
    logger.debug(`Job ${job.id} progress: ${progress}%`, {
      documentId: job.data.documentId
    });
  });

  queue.on('stalled', (job) => {
    logger.warn(`Job ${job.id} stalled`, {
      documentId: job.data.documentId,
      stalledCount: job.stalledCount || 0
    });
  });
}

/**
 * Clean up function for graceful shutdown
 */
async function cleanupJob(documentId, reason = 'shutdown') {
  try {
    const document = await Document.findById(documentId);
    if (document && document.processingStatus === DOCUMENT_STATUS.PROCESSING) {
      await document.updateStatus(
        DOCUMENT_STATUS.FAILED, 
        `Processing interrupted: ${reason}`
      );
      logger.info(`Cleaned up interrupted processing for document ${documentId}`);
    }
  } catch (error) {
    logger.error(`Error during job cleanup for document ${documentId}:`, error);
  }
}

/**
 * Retry strategy for failed jobs
 */
function getRetryDelay(attemptsMade) {
  // Exponential backoff: 2^attempt * 1000ms, max 30 seconds
  return Math.min(Math.pow(2, attemptsMade) * 1000, 30000);
}

/**
 * Job statistics and monitoring
 */
async function getJobStatistics(queue) {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length
    };
  } catch (error) {
    logger.error('Error getting job statistics:', error);
    return null;
  }
}

/**
 * Health check for job processing system
 */
async function healthCheck(queue) {
  try {
    const stats = await getJobStatistics(queue);
    const etlHealth = await etlService.healthCheck();

    return {
      status: etlHealth.status === 'healthy' && stats ? 'healthy' : 'unhealthy',
      jobStats: stats,
      etlService: etlHealth,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Job processor health check failed:', error);
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  processDocumentJob,
  setupJobEventHandlers,
  cleanupJob,
  getRetryDelay,
  getJobStatistics,
  healthCheck
};