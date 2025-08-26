const { MeiliSearch } = require('meilisearch');
const logger = require('../utils/logger');

class MeiliSearchClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const config = {
        host: process.env.MEILISEARCH_HOST || 'http://127.0.0.1:7700'
      };

      if (process.env.MEILISEARCH_API_KEY) {
        config.apiKey = process.env.MEILISEARCH_API_KEY;
      }

      this.client = new MeiliSearch(config);

      // Test connection
      await this.client.health();
      this.isConnected = true;

      logger.info('Connected to MeiliSearch');
      return this.client;
    } catch (error) {
      logger.error('Failed to connect to MeiliSearch:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async createIndex(indexName, primaryKey = 'id') {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const task = await this.client.createIndex(indexName, { primaryKey });
      logger.info(`Created MeiliSearch index: ${indexName}`);
      return task;
    } catch (error) {
      // Index might already exist
      if (error.code === 'index_already_exists') {
        logger.info(`MeiliSearch index already exists: ${indexName}`);
        return null;
      }
      logger.error(`Error creating MeiliSearch index ${indexName}:`, error);
      throw error;
    }
  }

  async configureIndex(indexName, settings) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const index = this.client.index(indexName);
      
      // Configure searchable attributes
      if (settings.searchableAttributes) {
        await index.updateSearchableAttributes(settings.searchableAttributes);
        logger.info(`Updated searchable attributes for ${indexName}`);
      }

      // Configure filterable attributes
      if (settings.filterableAttributes) {
        await index.updateFilterableAttributes(settings.filterableAttributes);
        logger.info(`Updated filterable attributes for ${indexName}`);
      }

      // Configure sortable attributes
      if (settings.sortableAttributes) {
        await index.updateSortableAttributes(settings.sortableAttributes);
        logger.info(`Updated sortable attributes for ${indexName}`);
      }

      // Configure ranking rules
      if (settings.rankingRules) {
        await index.updateRankingRules(settings.rankingRules);
        logger.info(`Updated ranking rules for ${indexName}`);
      }

      // Configure stop words
      if (settings.stopWords) {
        await index.updateStopWords(settings.stopWords);
        logger.info(`Updated stop words for ${indexName}`);
      }

      return true;
    } catch (error) {
      logger.error(`Error configuring MeiliSearch index ${indexName}:`, error);
      throw error;
    }
  }

  async addDocuments(indexName, documents) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const index = this.client.index(indexName);
      const task = await index.addDocuments(documents);
      
      logger.info(`Added ${documents.length} documents to index ${indexName}`);
      return task;
    } catch (error) {
      logger.error(`Error adding documents to ${indexName}:`, error);
      throw error;
    }
  }

  async search(indexName, query, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const index = this.client.index(indexName);
      const results = await index.search(query, options);
      
      return results;
    } catch (error) {
      logger.error(`Error searching in ${indexName}:`, error);
      throw error;
    }
  }

  async deleteDocument(indexName, documentId) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const index = this.client.index(indexName);
      const task = await index.deleteDocument(documentId);
      
      logger.info(`Deleted document ${documentId} from index ${indexName}`);
      return task;
    } catch (error) {
      logger.error(`Error deleting document from ${indexName}:`, error);
      throw error;
    }
  }

  async deleteIndex(indexName) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const task = await this.client.deleteIndex(indexName);
      logger.info(`Deleted MeiliSearch index: ${indexName}`);
      return task;
    } catch (error) {
      logger.error(`Error deleting MeiliSearch index ${indexName}:`, error);
      throw error;
    }
  }

  async getStats(indexName) {
    try {
      if (!this.isConnected) {
        throw new Error('MeiliSearch not connected');
      }

      const index = this.client.index(indexName);
      return await index.getStats();
    } catch (error) {
      logger.error(`Error getting stats for ${indexName}:`, error);
      throw error;
    }
  }

  getClient() {
    return this.client;
  }

  isHealthy() {
    return this.isConnected;
  }
}

// Singleton instance
const meiliSearchClient = new MeiliSearchClient();

module.exports = meiliSearchClient;