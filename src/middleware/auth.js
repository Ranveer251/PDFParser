const { HTTP_STATUS, ERROR_CODES } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Simple API Key authentication middleware
 */
const authenticate = (req, res, next) => {
  const apiKey = req.header('X-API-Key') || req.query.apiKey;

  if (!apiKey) {
    logger.warn('Authentication failed: No API key provided', {
      ip: req.ip,
      path: req.path
    });
    
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: 'API key required',
      code: ERROR_CODES.UNAUTHORIZED
    });
  }

  if (apiKey !== process.env.API_KEY) {
    logger.warn('Authentication failed: Invalid API key', {
      ip: req.ip,
      path: req.path,
      providedKey: apiKey
    });
    
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: 'Invalid API key',
      code: ERROR_CODES.UNAUTHORIZED
    });
  }

  logger.info('Authentication successful', {
    ip: req.ip,
    path: req.path
  });

  next();
};

module.exports = { authenticate };