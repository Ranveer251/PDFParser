const database = require('../database/connection');
const redisClient = require('../config/redis');
const meiliSearchClient = require('../config/meilisearch');
const queueManager = require('../config/queue');
const { setupJobEventHandlers } = require('../jobs/processDocument');
const logger = require('./logger');

/**
 * Initialize all application services and dependencies
 */
async function initializeApplication() {
  const services = [];
  const errors = [];

  try {
    logger.info('🚀 Starting application initialization...');

    // 1. Initialize Database
    try {
      logger.info('📊 Connecting to database...');
      await database.connect();
      services.push('Database');
      logger.info('✅ Database connected successfully');
    } catch (error) {
      errors.push({ service: 'Database', error: error.message });
      logger.error('❌ Database connection failed:', error);
      throw error; // Database is critical, fail fast
    }

    // 2. Initialize Redis (optional for basic functionality)
    try {
      logger.info('🔴 Connecting to Redis...');
      await redisClient.connect();
      services.push('Redis');
      logger.info('✅ Redis connected successfully');
    } catch (error) {
      errors.push({ service: 'Redis', error: error.message });
      logger.warn('⚠️ Redis connection failed, caching will be disabled:', error.message);
    }

    // 3. Initialize MeiliSearch
    try {
      logger.info('🔍 Connecting to MeiliSearch...');
      await meiliSearchClient.connect();
      services.push('MeiliSearch');
      logger.info('✅ MeiliSearch connected successfully');
    } catch (error) {
      errors.push({ service: 'MeiliSearch', error: error.message });
      logger.error('❌ MeiliSearch connection failed:', error);
      throw error; // Search is critical for this application
    }

    // 4. Initialize Queue Manager (depends on Redis)
    try {
      if (redisClient.isConnected) {
        logger.info('📋 Initializing job queue...');
        await queueManager.initialize();
        
        // Set up job processors
        const documentQueue = queueManager.getQueue('document');
        setupJobEventHandlers(documentQueue);
        
        services.push('Queue Manager');
        logger.info('✅ Queue manager initialized successfully');
      } else {
        logger.warn('⚠️ Queue manager skipped - Redis not available');
      }
    } catch (error) {
      errors.push({ service: 'Queue Manager', error: error.message });
      logger.error('❌ Queue manager initialization failed:', error);
      // Queue is important but not critical for basic functionality
    }

    // 5. Run health checks on all services
    logger.info('🏥 Running health checks...');
    const healthChecks = await runHealthChecks();

    logger.info('🎉 Application initialization completed', {
      services: services,
      healthChecks: healthChecks,
      errors: errors.length > 0 ? errors : undefined
    });

    return {
      success: true,
      services,
      healthChecks,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    logger.error('💥 Application initialization failed:', error);
    
    // Attempt graceful cleanup
    await cleanup();
    
    return {
      success: false,
      error: error.message,
      services,
      errors
    };
  }
}

/**
 * Run health checks on all initialized services
 */
async function runHealthChecks() {
  const checks = {};

  // Database health check
  try {
    await database.get('SELECT 1');
    checks.database = { status: 'healthy', timestamp: new Date().toISOString() };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
  }

  // Redis health check
  if (redisClient.isConnected) {
    try {
      await redisClient.set('health:check', 'ok', 10);
      await redisClient.get('health:check');
      checks.redis = { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      checks.redis = { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
    }
  } else {
        checks.redis = { status: 'skipped', reason: 'Redis not connected', timestamp: new Date().toISOString() };
  }
  // MeiliSearch health check
  try {
      await meiliSearchClient.health();
      checks.meiliSearch = { status: 'healthy', timestamp: new Date().toISOString() };
  }
  catch (error) {
    checks.meiliSearch = { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
  }
  // Queue Manager health check
  if (queueManager.isInitialized) {
    try {
        const documentQueue = queueManager.getQueue('document');
        const jobCounts = await documentQueue.getJobCounts();
        checks.queueManager = { status: 'healthy', jobCounts, timestamp: new Date().toISOString() };
    } catch (error) {
        checks.queueManager = { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
    }
  } else {
    checks.queueManager = { status: 'skipped', reason: 'Queue manager not initialized', timestamp: new Date().toISOString() };
  }
  return checks;
}

module.exports = {
    initializeApplication,
    runHealthChecks
};