const rateLimit = require('express-rate-limit');
const { HTTP_STATUS, ERROR_CODES } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later',
    code: ERROR_CODES.RATE_LIMITED
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: 'Too many requests from this IP, please try again later',
      code: ERROR_CODES.RATE_LIMITED,
      retryAfter: Math.round(parseInt(process.env.RATE_LIMIT_WINDOW_MS) / 1000) || 900
    });
  }
});

/**
 * Stricter rate limiter for file uploads
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads per window
  message: {
    success: false,
    error: 'Too many file uploads, please try again later',
    code: ERROR_CODES.RATE_LIMITED
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Upload rate limit exceeded', {
      ip: req.ip,
      path: req.path
    });
    
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
      success: false,
      error: 'Too many file uploads, please try again later',
      code: ERROR_CODES.RATE_LIMITED,
      retryAfter: 900
    });
  }
});

/**
 * Rate limiter for search endpoints
 */
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: {
    success: false,
    error: 'Too many search requests, please try again later',
    code: ERROR_CODES.RATE_LIMITED
  }
});

module.exports = {
  apiLimiter,
  uploadLimiter,
  searchLimiter
};