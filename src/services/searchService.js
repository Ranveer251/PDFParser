const indexService = require('./indexService');
const Document = require('../models/Document');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { SEARCH_CONFIG, CONTENT_TYPES, HTTP_STATUS } = require('../utils/constants');

class SearchService {
  constructor() {
    this.cachePrefix = 'search:';
    this.cacheTTL = 300; // 5 minutes
  }

  async searchDocument(documentId, query, options = {}) {
    try {
      // Validate inputs
      if (!documentId) {
        throw new Error('Document ID is required');
      }

      if (!query || query.trim().length < SEARCH_CONFIG.MIN_QUERY_LENGTH) {
        throw new Error(`Query must be at least ${SEARCH_CONFIG.MIN_QUERY_LENGTH} characters long`);
      }

      // Check if document exists and is ready
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      if (document.processingStatus !== 'completed') {
        throw new Error(`Document is not ready for search. Status: ${document.processingStatus}`);
      }

      // Normalize and clean query
      const cleanQuery = this.cleanSearchQuery(query);
      
      // Check cache first
      const cacheKey = this.generateCacheKey(documentId, cleanQuery, options);
      const cachedResults = await this.getCachedResults(cacheKey);
      
      if (cachedResults) {
        logger.info(`Search cache hit for document ${documentId}`, {
          query: cleanQuery.substring(0, 50),
          cacheKey
        });
        return cachedResults;
      }

      // Prepare search options
      const searchOptions = {
        limit: Math.min(options.limit || SEARCH_CONFIG.DEFAULT_LIMIT, SEARCH_CONFIG.MAX_RESULTS),
        offset: options.offset || 0,
        contentType: options.type,
        pageNumber: options.page,
        minConfidence: options.minConfidence,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        searchOptions: {
          attributesToCrop: ['content:50'],
          cropMarker: '...',
          showMatchesPosition: true,
          matchingStrategy: 'all' // or 'last' for phrase matching
        }
      };

      // Perform search
      const startTime = Date.now();
      const results = await indexService.search(documentId, cleanQuery, searchOptions);
      const searchTime = Date.now() - startTime;

      // Enhance results with document context
      const enhancedResults = await this.enhanceSearchResults(results, document);

      // Add search metadata
      const finalResults = {
        ...enhancedResults,
        searchMetadata: {
          originalQuery: query,
          cleanedQuery: cleanQuery,
          searchTime,
          cached: false,
          timestamp: new Date().toISOString()
        }
      };

      // Cache results if they're good
      if (results.hits.length > 0) {
        await this.cacheResults(cacheKey, finalResults);
      }

      logger.info(`Search completed for document ${documentId}`, {
        query: cleanQuery.substring(0, 50),
        resultsCount: results.hits.length,
        searchTime
      });

      return finalResults;

    } catch (error) {
      logger.error(`Search failed for document ${documentId}:`, error);
      throw error;
    }
  }

  async searchSuggestions(documentId, query, limit = 5) {
    try {
      if (!query || query.length < 2) {
        return { suggestions: [] };
      }

      // Use prefix search for suggestions
      const results = await indexService.search(documentId, query, {
        limit,
        searchOptions: {
          attributesToRetrieve: ['content'],
          attributesToCrop: ['content:10'],
          cropMarker: '...'
        }
      });

      // Extract unique word suggestions from results
      const suggestions = this.extractSuggestions(results.hits, query);

      return {
        suggestions: suggestions.slice(0, limit),
        query,
        documentId
      };

    } catch (error) {
      logger.error(`Search suggestions failed for document ${documentId}:`, error);
      return { suggestions: [] };
    }
  }

  cleanSearchQuery(query) {
    return query
      .trim()
      .toLowerCase()
      // Remove special characters that might break search
      .replace(/[^\w\s\-'"]/g, ' ')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  generateCacheKey(documentId, query, options) {
    const optionsHash = Buffer.from(JSON.stringify({
      limit: options.limit,
      offset: options.offset,
      type: options.type,
      page: options.page,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder
    })).toString('base64');

    return `${this.cachePrefix}${documentId}:${Buffer.from(query).toString('base64')}:${optionsHash}`;
  }

  async getCachedResults(cacheKey) {
    try {
      const cached = await redisClient.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Cache retrieval failed:', error);
      return null;
    }
  }

  async cacheResults(cacheKey, results) {
    try {
      await redisClient.set(
        cacheKey, 
        JSON.stringify(results), 
        this.cacheTTL
      );
    } catch (error) {
      logger.warn('Cache storage failed:', error);
    }
  }

  async enhanceSearchResults(results, document) {
    // Add document context to results
    const enhancedHits = results.hits.map(hit => ({
      ...hit,
      document: {
        id: document.id,
        filename: document.originalName,
        totalPages: document.totalPages,
        totalChunks: document.totalChunks
      }
    }));

    return {
      ...results,
      hits: enhancedHits,
      document: document.toJSON()
    };
  }

  extractSuggestions(hits, query) {
    const suggestions = new Set();
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const hit of hits) {
      if (hit.content) {
        // Extract words that start with query or contain query words
        const words = hit.content.toLowerCase().split(/\s+/);
        
        for (const word of words) {
          // Clean word
          const cleanWord = word.replace(/[^\w]/g, '');
          
          if (cleanWord.length > 2 && 
              (cleanWord.startsWith(query.toLowerCase()) ||
               queryWords.some(qw => cleanWord.includes(qw)))) {
            suggestions.add(cleanWord);
          }
        }
      }
    }

    return Array.from(suggestions);
  }

  analyzeChunks(chunks) {
    const stats = {
      total: chunks.length,
      byType: {},
      byPage: {},
      totalWords: 0,
      avgConfidence: 0,
      confidence: { high: 0, medium: 0, low: 0 }
    };

    // Initialize type counters
    Object.values(CONTENT_TYPES).forEach(type => {
      stats.byType[type] = 0;
    });

    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const chunk of chunks) {
      // Count by type
      if (stats.byType[chunk.type] !== undefined) {
        stats.byType[chunk.type]++;
      }

      // Count by page
      const page = chunk.pageNumber || 1;
      stats.byPage[page] = (stats.byPage[page] || 0) + 1;

      // Word count
      if (chunk.content) {
        stats.totalWords += chunk.content.split(/\s+/).length;
      }

      // Confidence analysis (for OCR chunks)
      if (chunk.ocrConfidence !== null && chunk.ocrConfidence !== undefined) {
        totalConfidence += chunk.ocrConfidence;
        confidenceCount++;

        if (chunk.ocrConfidence >= 80) {
          stats.confidence.high++;
        } else if (chunk.ocrConfidence >= 60) {
          stats.confidence.medium++;
        } else {
          stats.confidence.low++;
        }
      }
    }

    stats.avgConfidence = confidenceCount > 0 ? 
      Math.round(totalConfidence / confidenceCount) : 0;

    return stats;
  }

  async invalidateCache(documentId) {
    try {
      // This is a simple implementation - in production, you might want
      // to use Redis SCAN to find all matching keys
      const pattern = `${this.cachePrefix}${documentId}:*`;
      logger.info(`Cache invalidation requested for pattern: ${pattern}`);
      
      // Note: This is a placeholder - actual implementation would depend on
      // Redis configuration and available commands
      return true;
    } catch (error) {
      logger.warn('Cache invalidation failed:', error);
      return false;
    }
  }

  async healthCheck() {
    try {
      // Test basic functionality with a mock search
      const testQuery = 'health check test';
      const cleanedQuery = this.cleanSearchQuery(testQuery);
      
      if (!cleanedQuery) {
        throw new Error('Query cleaning failed');
      }

      // Test cache functionality
      const testCacheKey = `${this.cachePrefix}health:test`;
      await redisClient.set(testCacheKey, 'test', 10);
      const cached = await redisClient.get(testCacheKey);
      await redisClient.del(testCacheKey);

      if (cached !== 'test') {
        throw new Error('Cache test failed');
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Search service health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Singleton instance
const searchService = new SearchService();

module.exports = searchService;