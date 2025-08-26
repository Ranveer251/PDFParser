const express = require('express');
const { authenticate } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimit');

// Import route modules
const documentRoutes = require('./documents');
const searchRoutes = require('./search');

const router = express.Router();

// Apply global middleware to all API routes
router.use(apiLimiter);
router.use(authenticate);

// API information endpoint
router.get('/', (req, res) => {
  res.json({
    name: 'PDF Search API',
    version: '1.0.0',
    description: 'Search API for unstructured PDF data with ETL pipeline',
    endpoints: {
      documents: '/api/documents',
      search: '/api/search'
    },
    documentation: '/api/docs'
  });
});

// Health check endpoint (no auth required)
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      api: 'operational',
      database: 'operational',
      search: 'operational',
      queue: 'operational'
    }
  });
});

// Mount route modules
router.use('/documents', documentRoutes);
router.use('/search', searchRoutes);

module.exports = router;