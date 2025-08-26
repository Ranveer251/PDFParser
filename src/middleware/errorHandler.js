const logger = require('../utils/logger');
const { HTTP_STATUS } = require('../utils/constants');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('API Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: HTTP_STATUS.NOT_FOUND };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: HTTP_STATUS.BAD_REQUEST };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message);
    error = { message, statusCode: HTTP_STATUS.BAD_REQUEST };
  }

  // Joi validation error
  if (err.isJoi) {
    const message = err.details[0].message;
    error = { message, statusCode: HTTP_STATUS.BAD_REQUEST };
  }

  // Multer file upload error
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = { message, statusCode: HTTP_STATUS.BAD_REQUEST };
  }

  // Default error
  const statusCode = error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = error.message || 'Server Error';

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;