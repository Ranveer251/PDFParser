const express = require('express');
const searchController = require('../controllers/searchController');
const { searchLimiter } = require('../middleware/rateLimit');
const { 
  validateSearch, 
  validateDocumentOperation, 
  validateQuery,
  searchSuggestionsSchema,
  documentIdSchema 
} = require('../utils/validators');
const Joi = require('joi');
const { CONTENT_TYPES } = require('../utils/constants');

const router = express.Router();

/**
 * @route   GET /api/search/health
 * @desc    Check search service health
 * @access  Authenticated
 */
router.get('/health',
  searchController.getSearchHealth
);

/**
 * @route   GET /api/search/:id
 * @desc    Search within a specific document
 * @access  Authenticated
 * @params  id - Document UUID
 * @query   q (required), type, page, limit, offset, minConfidence, sortBy, sortOrder, highlight
 */
router.get('/:id',
  searchLimiter,
  validateSearch,
  searchController.searchDocument
);

/**
 * @route   GET /api/search/:id/suggestions
 * @desc    Get search suggestions/autocomplete for a document
 * @access  Authenticated
 * @params  id - Document UUID
 * @query   q (required), limit
 */
router.get('/:id/suggestions',
  searchLimiter,
  validateDocumentOperation[0], // Just validate document ID
  validateQuery(searchSuggestionsSchema),
  searchController.getSearchSuggestions
);

/**
 * @route   GET /api/search/:id/stats
 * @desc    Get search statistics and analytics for a document
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.get('/:id/stats',
  validateDocumentOperation,
  searchController.getSearchStats
);

/**
 * @route   GET /api/search/:id/type/:type
 * @desc    Search within a specific content type of a document
 * @access  Authenticated
 * @params  id - Document UUID, type - Content type (paragraph, image, table)
 * @query   q (required), limit, offset
 */
router.get('/:id/type/:type',
  searchLimiter,
  validateDocumentOperation[0], // Validate document ID
  (req, res, next) => {
    // Validate content type parameter
    const schema = Joi.object({
      type: Joi.string().valid(...Object.values(CONTENT_TYPES)).required()
    });
    
    const { error, value } = schema.validate({ type: req.params.type });
    if (error) {
      return res.status(400).json({
        success: false,
        error: `Invalid content type. Must be one of: ${Object.values(CONTENT_TYPES).join(', ')}`
      });
    }
    
    req.params = { ...req.params, ...value };
    next();
  },
  validateQuery(Joi.object({
    q: Joi.string().min(2).max(200).required(),
    limit: Joi.number().integer().min(1).max(100).default(20).optional(),
    offset: Joi.number().integer().min(0).default(0).optional()
  })),
  searchController.searchByContentType
);

/**
 * @route   GET /api/search/:id/page/:pageNumber
 * @desc    Search within a specific page of a document
 * @access  Authenticated
 * @params  id - Document UUID, pageNumber - Page number
 * @query   q (required), type, limit
 */
router.get('/:id/page/:pageNumber',
  searchLimiter,
  validateDocumentOperation[0], // Validate document ID
  (req, res, next) => {
    // Validate page number parameter
    const schema = Joi.object({
      pageNumber: Joi.number().integer().min(1).required()
    });
    
    const { error, value } = schema.validate({ 
      pageNumber: parseInt(req.params.pageNumber) 
    });
    
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid page number. Must be a positive integer'
      });
    }
    
    req.params.pageNumber = value.pageNumber;
    next();
  },
  validateQuery(Joi.object({
    q: Joi.string().min(2).max(200).required(),
    type: Joi.string().valid(...Object.values(CONTENT_TYPES)).optional(),
    limit: Joi.number().integer().min(1).max(100).default(20).optional()
  })),
  searchController.searchDocumentPage
);

/**
 * @route   POST /api/search/:id/cache/clear
 * @desc    Clear search cache for a document
 * @access  Authenticated
 * @params  id - Document UUID
 */
router.post('/:id/cache/clear',
  validateDocumentOperation,
  searchController.clearSearchCache
);

/**
 * @route   GET /api/search/:id/popular-terms
 * @desc    Get popular search terms for a document
 * @access  Authenticated
 * @params  id - Document UUID
 * @query   limit, period
 */
router.get('/:id/popular-terms',
  validateDocumentOperation[0], // Validate document ID
  validateQuery(Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(10).optional(),
    period: Joi.string().valid('1d', '7d', '30d', '90d').default('7d').optional()
  })),
  searchController.getPopularSearchTerms
);

/**
 * @route   GET /api/search/:id/test
 * @desc    Perform a test search to validate functionality
 * @access  Authenticated
 * @params  id - Document UUID
 * @query   testQuery (optional)
 */
router.get('/:id/test',
  validateDocumentOperation[0], // Validate document ID
  validateQuery(Joi.object({
    testQuery: Joi.string().min(1).max(100).default('test').optional()
  })),
  searchController.testSearch
);

module.exports = router;