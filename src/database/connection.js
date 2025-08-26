const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(process.env.DB_PATH || './data/documents.db');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const dbPath = process.env.DB_PATH || './data/documents.db';
      
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          logger.error('Error connecting to SQLite database:', err);
          throw err;
        }
        logger.info(`Connected to SQLite database at ${dbPath}`);
      });

      // Enable foreign key constraints
      await this.run('PRAGMA foreign_keys = ON');
      
      // Configure SQLite for better performance
      await this.run('PRAGMA journal_mode = WAL');
      await this.run('PRAGMA synchronous = NORMAL');
      await this.run('PRAGMA temp_store = MEMORY');
      await this.run('PRAGMA mmap_size = 268435456'); // 256MB

      this.isConnected = true;
      return this.db;
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database run error:', err);
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          logger.error('Error closing database:', err);
          reject(err);
        } else {
          logger.info('Database connection closed');
          this.isConnected = false;
          resolve();
        }
      });
    });
  }

  getDb() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return this.db;
  }
}

// Singleton instance
const database = new Database();

module.exports = database;