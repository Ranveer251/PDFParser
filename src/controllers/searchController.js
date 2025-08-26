const searchService = require('../services/searchService');
const Document = require('../models/Document');
const logger = require('../utils/logger');
const { HTTP_STATUS, DOCUMENT_STATUS } = require('../utils/constants');

class SearchController {
  /**
   * Search within a specific document
   */
  async searchDocument(req, res) {
    try {
      const { id } = req.params;
      const { 
        q: query, 
        type, 
        page, 
        limit, 
        offset, 
        minConfidence, 
        sortBy, 
        sortOrder,
        highlight = true
      } = req.query;

      logger.info('Document search requested', {
        documentId: id,
        query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
        filters: { type, page, minConfidence },
        pagination: { limit, offset },
        ip: req.ip
      });

      // Perform search
      const results = await searchService.searchDocument(id, query, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        type,
        page: page ? parseInt(page) : null,
        minConfidence: minConfidence ? parseFloat(minConfidence) : null,
        sortBy,
        sortOrder,
        highlight
      });

      // Log search metrics
      logger.info('Search completed successfully', {
        documentId: id,
        query: query.substring(0, 50),
        resultsCount: results.hits.length,
        totalEstimated: results.estimatedTotalHits || results.nbHits,
        processingTime: results.processingTime
      });

      res.json({
        success: true,
        data: results
      });

    } catch (error) {
      logger.error('Document search failed:', {
        documentId: req.params.id,
        query: req.query.q,
        error: error.message,
        ip: req.ip
      });

      // Handle specific error types
      if (error.message.includes('Document not found')) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      if (error.message.includes('not ready for search')) {
        return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
          success: false,
          error: error.message
        });
      }

      if (error.message.includes('Query must be at least')) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: error.message
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Search failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get search suggestions for a document
   */
  async getSearchSuggestions(req, res) {
    try {
      const { id } = req.params;
      const { q: query, limit = 5 } = req.query;

      logger.info('Search suggestions requested', {
        documentId: id,
        query: query.substring(0, 50),
        limit
      });

      const suggestions = await searchService.searchSuggestions(
        id, 
        query, 
        parseInt(limit)
      );

      res.json({
        success: true,
        data: suggestions
      });

    } catch (error) {
      logger.error('Search suggestions failed:', {
        documentId: req.params.id,
        query: req.query.q,
        error: error.message
      });

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to get search suggestions',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  /**
   * Get document search statistics and analytics
   */
  async getSearchStats(req, res) {
    try {
      const { id } = req.params;

      logger.info('Search stats requested', {
        documentId: id
      });

      const stats = await searchService.getDocumentStats(id);

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Failed to get search stats:', {
        documentId: req.params.id,
        error: error.message
      });

      if (error.message.includes('Document not found')) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve search statistics'
      });
    }
  }

  /**
   * Search across document content types
   */
  async searchByContentType(req, res) {
    try {
      const { id } = req.params;
      const { type } = req.params;
      const { q: query, limit = 20, offset = 0 } = req.query;

      // Validate content type is handled in route validation

      logger.info('Content type search requested', {
        documentId: id,
        contentType: type,
        query: query.substring(0, 50)
      });

      const results = await searchService.searchDocument(id, query, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        type: type
      });

      res.json({
        success: true,
        data: {
          ...results,
          searchType: 'content-type',
          contentType: type
        }
      });

    } catch (error) {
      logger.error('Content type search failed:', {
        documentId: req.params.id,
        contentType: req.params.type,
        error: error.message
      });

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Content type search failed'
      });
    }
  }

  /**
   * Search within a specific page of a document
   */
  async searchDocumentPage(req, res) {
    try {
      const { id, pageNumber } = req.params;
      const { q: query, type, limit = 20 } = req.query;

      const page = parseInt(pageNumber);
      if (isNaN(page) || page < 1) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: 'Invalid page number'
        });
      }

      logger.info('Page search requested', {
        documentId: id,
        pageNumber: page,
        query: query.substring(0, 50)
      });

      const results = await searchService.searchDocument(id, query, {
        limit: parseInt(limit),
        page: page,
        type: type || undefined
      });

      res.json({
        success: true,
        data: {
          ...results,
          searchType: 'page-specific',
          pageNumber: page
        }
      });

    } catch (error) {
      logger.error('Page search failed:', {
        documentId: req.params.id,
        pageNumber: req.params.pageNumber,
        error: error.message
      });

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Page search failed'
      });
    }
  }

  /**
   * Get search health and performance metrics
   */
  async getSearchHealth(req, res) {
    try {
      const health = await searchService.healthCheck();

      const status = health.status === 'healthy' ? 
        HTTP_STATUS.OK : 
        HTTP_STATUS.INTERNAL_SERVER_ERROR;

      res.status(status).json({
        success: health.status === 'healthy',
        data: health
      });

    } catch (error) {
      logger.error('Search health check failed:', error);

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Health check failed',
        data: {
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Clear search cache for a document
   */
  async clearSearchCache(req, res) {
    try {
      const { id } = req.params;

      // Verify document exists
      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      // Invalidate cache
      const cacheCleared = await searchService.invalidateCache(id);

      logger.info('Search cache cleared', {
        documentId: id,
        success: cacheCleared
      });

      res.json({
        success: true,
        message: 'Search cache cleared successfully',
        data: {
          documentId: id,
          cacheCleared
        }
      });

    } catch (error) {
      logger.error('Failed to clear search cache:', error);

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to clear search cache'
      });
    }
  }

  /**
   * Get popular search terms for a document (if tracking is implemented)
   */
  async getPopularSearchTerms(req, res) {
    try {
      const { id } = req.params;
      const { limit = 10, period = '7d' } = req.query;

      // Verify document exists
      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      // This is a placeholder - in a production system, you'd track search queries
      // and maintain analytics about popular terms
      const mockPopularTerms = [
        { term: 'example', count: 15, lastSearched: new Date() },
        { term: 'document', count: 12, lastSearched: new Date() },
        { term: 'search', count: 8, lastSearched: new Date() }
      ];

      res.json({
        success: true,
        data: {
          documentId: id,
          period,
          popularTerms: mockPopularTerms.slice(0, parseInt(limit)),
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Failed to get popular search terms:', error);

      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Failed to retrieve popular search terms'
      });
    }
  }

  /**
   * Perform a test search to validate search functionality
   */
  async testSearch(req, res) {
    try {
      const { id } = req.params;
      const testQuery = req.query.testQuery || 'test';

      logger.info('Test search requested', {
        documentId: id,
        testQuery
      });

      // Verify document exists and is ready
      const document = await Document.findById(id);
      if (!document) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
          success: false,
          error: 'Document not found'
        });
      }

      if (document.processingStatus !== DOCUMENT_STATUS.COMPLETED) {
        return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
          success: false,
          error: `Document is not ready for search. Status: ${document.processingStatus}`
        });
      }

      const startTime = Date.now();
      const results = await searchService.searchDocument(id, testQuery, { limit: 5 });
      const searchTime = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Test search completed successfully',
        data: {
          documentId: id,
          testQuery,
          searchTime,
          resultsFound: results.hits.length,
          searchWorking: true,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Test search failed:', error);

      res.json({
        success: false,
        message: 'Test search failed',
        data: {
          documentId: req.params.id,
          testQuery: req.query.testQuery || 'test',
          searchWorking: false,
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
}

module.exports = new SearchController();