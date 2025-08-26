const Joi = require('joi');
const { CONTENT_TYPES, SEARCH_CONFIG } = require('./constants');

// Document upload validation
const uploadDocumentSchema = Joi.object({
  // File validation will be handled by multer
  metadata: Joi.object({
    title: Joi.string().max(255).optional(),
    description: Joi.string().max(1000).optional(),
    tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    category: Joi.string().max(100).optional()
  }).optional()
});

// Search validation
const searchDocumentSchema = Joi.object({
  q: Joi.string()
    .min(SEARCH_CONFIG.MIN_QUERY_LENGTH)
    .max(200)
    .required()
    .messages({
      'string.min': `Query must be at least ${SEARCH_CONFIG.MIN_QUERY_LENGTH} characters long`,
      'string.max': 'Query cannot exceed 200 characters',
      'any.required': 'Query parameter "q" is required'
    }),
  
  type: Joi.string()
    .valid(...Object.values(CONTENT_TYPES))
    .optional()
    .messages({
      'any.only': `Type must be one of: ${Object.values(CONTENT_TYPES).join(', ')}`
    }),
  
  page: Joi.number()
    .integer()
    .min(1)
    .optional()
    .messages({
      'number.base': 'Page must be a number',
      'number.integer': 'Page must be an integer',
      'number.min': 'Page must be at least 1'
    }),
  
  limit: Joi.number()
    .integer()
    .min(1)
    .max(SEARCH_CONFIG.MAX_RESULTS)
    .default(SEARCH_CONFIG.DEFAULT_LIMIT)
    .optional()
    .messages({
      'number.max': `Limit cannot exceed ${SEARCH_CONFIG.MAX_RESULTS}`
    }),
  
  offset: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .optional(),
  
  minConfidence: Joi.number()
    .min(0)
    .max(100)
    .optional()
    .messages({
      'number.min': 'Minimum confidence must be at least 0',
      'number.max': 'Minimum confidence cannot exceed 100'
    }),
  
  sortBy: Joi.string()
    .valid('pageNumber', 'ocrConfidence', 'createdAt')
    .optional(),
  
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .optional(),
    
  highlight: Joi.boolean()
    .default(true)
    .optional()
});

// Search suggestions validation
const searchSuggestionsSchema = Joi.object({
  q: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.min': 'Query must be at least 2 characters long for suggestions'
    }),
  
  limit: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(5)
    .optional()
});

// Document ID validation
const documentIdSchema = Joi.object({
  id: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.uuid': 'Document ID must be a valid UUID',
      'any.required': 'Document ID is required'
    })
});

// Pagination validation
const paginationSchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .optional(),
  
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(20)
    .optional(),
  
  sortBy: Joi.string()
    .valid('uploadTime', 'filename', 'processingStatus', 'totalPages')
    .default('uploadTime')
    .optional(),
  
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .optional()
});

// Document status filter validation
const documentFilterSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'processing', 'completed', 'failed')
    .optional(),
  
  fromDate: Joi.date()
    .iso()
    .optional(),
  
  toDate: Joi.date()
    .iso()
    .greater(Joi.ref('fromDate'))
    .optional()
    .messages({
      'date.greater': 'To date must be after from date'
    })
});

// Health check validation
const healthCheckSchema = Joi.object({
  detailed: Joi.boolean()
    .default(false)
    .optional()
});

// Validation middleware factory
const validateRequest = (schema, property = 'body') => {
  return (req, res, next) => {
    const dataToValidate = req[property];
    
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errorDetails
      });
    }

    // Replace the original data with validated and sanitized data
    req[property] = value;
    next();
  };
};

// Validation middleware for query parameters
const validateQuery = (schema) => validateRequest(schema, 'query');

// Validation middleware for URL parameters
const validateParams = (schema) => validateRequest(schema, 'params');

// Validation middleware for request body
const validateBody = (schema) => validateRequest(schema, 'body');

// Combined validation for search endpoints
const validateSearch = [
  validateParams(documentIdSchema),
  validateQuery(searchDocumentSchema)
];

// Combined validation for document operations
const validateDocumentOperation = [
  validateParams(documentIdSchema)
];

// Combined validation for document listing
const validateDocumentList = [
  validateQuery(Joi.object().keys({
    ...paginationSchema.describe().keys,
    ...documentFilterSchema.describe().keys
  }))
];

// File upload validation (to be used after multer)
const validateUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No file uploaded',
      details: [{ field: 'pdf', message: 'PDF file is required' }]
    });
  }

  // Validate optional metadata if provided
  if (req.body.metadata) {
    try {
      req.body.metadata = JSON.parse(req.body.metadata);
      const { error, value } = uploadDocumentSchema.validate(req.body);
      
      if (error) {
        const errorDetails = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }));

        return res.status(400).json({
          success: false,
          error: 'Metadata validation failed',
          details: errorDetails
        });
      }
      
      req.body = value;
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid metadata JSON format'
      });
    }
  }

  next();
};

// Sanitization helpers
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, '');
};

const sanitizeSearchQuery = (query) => {
  return query
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 200); // Enforce max length
};

module.exports = {
  // Schemas
  uploadDocumentSchema,
  searchDocumentSchema,
  searchSuggestionsSchema,
  documentIdSchema,
  paginationSchema,
  documentFilterSchema,
  healthCheckSchema,

  // Validation middleware
  validateRequest,
  validateQuery,
  validateParams,
  validateBody,
  validateSearch,
  validateDocumentOperation,
  validateDocumentList,
  validateUpload,

  // Sanitization
  sanitizeString,
  sanitizeSearchQuery
};