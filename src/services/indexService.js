const meiliSearchClient = require('../config/meilisearch');
const logger = require('../utils/logger');
const { CONTENT_TYPES } = require('../utils/constants');

class IndexService {
  constructor() {
    this.indexPrefix = 'pdf_search';
    this.defaultSettings = {
      searchableAttributes: ['content', 'metadata.title', 'metadata.description'],
      filterableAttributes: ['documentId', 'type', 'pageNumber'],
      sortableAttributes: ['pageNumber', 'createdAt'],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness'
      ],
      stopWords: [
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
        'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'can', 'shall'
      ]
    };
  }

  getIndexName(documentId) {
    return `${this.indexPrefix}_${documentId}`;
  }

  async createDocumentIndex(documentId) {
    try {
      const indexName = this.getIndexName(documentId);
      
      // Ensure MeiliSearch is connected
      if (!meiliSearchClient.isHealthy()) {
        await meiliSearchClient.connect();
      }

      // Create index
      await meiliSearchClient.createIndex(indexName);
      
      // Configure index settings
      await meiliSearchClient.configureIndex(indexName, this.defaultSettings);

      logger.info(`Created and configured search index for document: ${documentId}`);
      return indexName;
    } catch (error) {
      logger.error(`Failed to create index for document ${documentId}:`, error);
      throw error;
    }
  }

  async indexDocumentChunks(documentId, chunks) {
    try {
      const indexName = this.getIndexName(documentId);
      
      // Transform chunks for search indexing
      const searchDocuments = chunks.map(chunk => ({
        id: chunk.id,
        documentId: documentId,
        type: chunk.type,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        position: chunk.position,
        ocrConfidence: chunk.ocrConfidence,
        metadata: {
          ...chunk.metadata,
          wordCount: chunk.content ? chunk.content.split(/\s+/).length : 0,
          contentLength: chunk.content ? chunk.content.length : 0
        },
        createdAt: chunk.createdAt || new Date().toISOString()
      }));

      // Add documents to search index
      const task = await meiliSearchClient.addDocuments(indexName, searchDocuments);

      logger.info(`Indexed ${chunks.length} chunks for document ${documentId}`, {
        indexName,
        taskUid: task.taskUid
      });

      return {
        indexName,
        documentsIndexed: chunks.length,
        taskUid: task.taskUid
      };
    } catch (error) {
      logger.error(`Failed to index chunks for document ${documentId}:`, error);
      throw error;
    }
  }

  async search(documentId, query, options = {}) {
    try {
      const indexName = this.getIndexName(documentId);
      
      const searchOptions = {
        limit: options.limit || 20,
        offset: options.offset || 0,
        attributesToHighlight: ['content'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
        attributesToRetrieve: [
          'id',
          'type',
          'content',
          'pageNumber',
          'position',
          'ocrConfidence',
          'metadata'
        ],
        ...options.searchOptions
      };

      // Add filters if specified
      const filters = [];
      
      if (options.contentType && Object.values(CONTENT_TYPES).includes(options.contentType)) {
        filters.push(`type = "${options.contentType}"`);
      }
      
      if (options.pageNumber) {
        filters.push(`pageNumber = ${options.pageNumber}`);
      }

      if (options.minConfidence && typeof options.minConfidence === 'number') {
        filters.push(`ocrConfidence >= ${options.minConfidence}`);
      }

      if (filters.length > 0) {
        searchOptions.filter = filters.join(' AND ');
      }

      // Add sorting
      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === 'desc' ? ':desc' : ':asc';
        searchOptions.sort = [`${sortField}${sortOrder}`];
      }

      const results = await meiliSearchClient.search(indexName, query, searchOptions);

      // Enhance results with additional metadata
      const enhancedResults = {
        ...results,
        query: query,
        documentId: documentId,
        processingTime: results.processingTimeMs,
        pagination: {
          offset: searchOptions.offset,
          limit: searchOptions.limit,
          total: results.estimatedTotalHits || results.nbHits,
          hasMore: (searchOptions.offset + searchOptions.limit) < (results.estimatedTotalHits || results.nbHits)
        }
      };

      logger.info(`Search completed for document ${documentId}`, {
        query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
        resultsCount: results.hits.length,
        totalEstimated: results.estimatedTotalHits || results.nbHits,
        processingTime: results.processingTimeMs
      });

      return enhancedResults;
    } catch (error) {
      logger.error(`Search failed for document ${documentId}:`, error);
      throw error;
    }
  }

  async deleteDocumentIndex(documentId) {
    try {
      const indexName = this.getIndexName(documentId);
      await meiliSearchClient.deleteIndex(indexName);
      
      logger.info(`Deleted search index for document: ${documentId}`);
    } catch (error) {
      // Don't throw error if index doesn't exist
      if (error.code === 'index_not_found') {
        logger.info(`Search index for document ${documentId} doesn't exist, skipping deletion`);
        return;
      }
      
      logger.error(`Failed to delete index for document ${documentId}:`, error);
      throw error;
    }
  }

  async reindexDocument(documentId, chunks) {
    try {
      // Delete existing index
      await this.deleteDocumentIndex(documentId);
      
      // Create new index
      await this.createDocumentIndex(documentId);
      
      // Index chunks
      return await this.indexDocumentChunks(documentId, chunks);
    } catch (error) {
      logger.error(`Failed to reindex document ${documentId}:`, error);
      throw error;
    }
  }

  async healthCheck() {
    try {
      if (!meiliSearchClient.isHealthy()) {
        await meiliSearchClient.connect();
      }

      // Test basic functionality
      const testIndexName = 'health_check_test';
      
      // Create test index
      await meiliSearchClient.createIndex(testIndexName);
      
      // Add test document
      await meiliSearchClient.addDocuments(testIndexName, [{
        id: 'test',
        content: 'health check test document'
      }]);

      // Wait a moment for indexing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Test search
      await meiliSearchClient.search(testIndexName, 'health');
      
      // Clean up
      await meiliSearchClient.deleteIndex(testIndexName);

      return {
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Index service health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Singleton instance
const indexService = new IndexService();

module.exports = indexService;