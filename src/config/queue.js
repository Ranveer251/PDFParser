const Bull = require('bull');
const redisClient = require('./redis');
const logger = require('../utils/logger');
const { QUEUE_CONFIG } = require('../utils/constants');
const { setupJobEventHandlers } = require('../jobs/processDocument');

class QueueManager {
  constructor() {
    this.queues = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure Redis is connected
      if (!redisClient.isConnected) {
        await redisClient.connect();
      }

      // Create document processing queue
      const documentQueue = new Bull(QUEUE_CONFIG.DOCUMENT_PROCESSING, {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
        },
        defaultJobOptions: {
          attempts: QUEUE_CONFIG.ATTEMPTS,
          backoff: {
            type: QUEUE_CONFIG.BACKOFF,
            delay: QUEUE_CONFIG.DELAY,
          },
          removeOnComplete: 10, // Keep last 10 completed jobs
          removeOnFail: 50, // Keep last 50 failed jobs for debugging
        },
      });
      // Set up job processing
      setupJobEventHandlers(documentQueue);

      this.queues.set('document', documentQueue);
      this.isInitialized = true;

      logger.info('Queue manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize queue manager:', error);
      throw error;
    }
  }

  getQueue(name) {
    if (!this.isInitialized) {
      throw new Error('Queue manager not initialized');
    }
    
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue '${name}' not found`);
    }
    
    return queue;
  }

  async addJob(queueName, jobData, options = {}) {
    try {
      const queue = this.getQueue(queueName);
      
      const jobOptions = {
        priority: options.priority || 0,
        delay: options.delay || 0,
        ...options
      };

      const job = await queue.add(jobData, jobOptions);
      
      logger.info(`Job added to ${queueName} queue:`, {
        jobId: job.id,
        data: jobData
      });
      
      return job;
    } catch (error) {
      logger.error(`Failed to add job to ${queueName} queue:`, error);
      throw error;
    }
  }

  async getQueueStats(queueName) {
    try {
      const queue = this.getQueue(queueName);
      
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
        delayed: delayed.length
      };
    } catch (error) {
      logger.error(`Failed to get stats for ${queueName} queue:`, error);
      throw error;
    }
  }

  async pauseQueue(queueName) {
    try {
      const queue = this.getQueue(queueName);
      await queue.pause();
      logger.info(`Queue ${queueName} paused`);
    } catch (error) {
      logger.error(`Failed to pause queue ${queueName}:`, error);
      throw error;
    }
  }

  async resumeQueue(queueName) {
    try {
      const queue = this.getQueue(queueName);
      await queue.resume();
      logger.info(`Queue ${queueName} resumed`);
    } catch (error) {
      logger.error(`Failed to resume queue ${queueName}:`, error);
      throw error;
    }
  }

  async cleanQueue(queueName, grace = 0, status = 'completed') {
    try {
      const queue = this.getQueue(queueName);
      await queue.clean(grace, status);
      logger.info(`Cleaned ${status} jobs from ${queueName} queue`);
    } catch (error) {
      logger.error(`Failed to clean ${queueName} queue:`, error);
      throw error;
    }
  }

  async closeAll() {
    try {
      const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
      await Promise.all(closePromises);
      this.queues.clear();
      this.isInitialized = false;
      logger.info('All queues closed');
    } catch (error) {
      logger.error('Error closing queues:', error);
    }
  }
}

// Singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;