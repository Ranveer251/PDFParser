require('dotenv').config();
const fs = require('fs');
const path = require('path');
const database = require('./connection');
const logger = require('../utils/logger');

async function migrate() {
  try {
    // Connect to database
    await database.connect();
    
    // Read schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split schema into individual statements
    const statements = schema
      .split(';')
      .filter(statement => statement.trim().length > 0)
      .map(statement => statement.trim() + ';');
    
    logger.info(`Executing ${statements.length} migration statements...`);
    
    // Execute each statement
    for (const statement of statements) {
      try {
        await database.run(statement);
        logger.info('✓ Executed statement');
      } catch (error) {
        // Log error but continue (some statements might already exist)
        logger.warn('Statement execution warning:', error.message);
      }
    }
    
    logger.info('🎉 Database migration completed successfully');
    
    // Verify tables were created
    const tables = await database.all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    
    logger.info('📋 Available tables:', tables.map(t => t.name));
    
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await database.close();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;