module.exports = {
    // Document processing status
    DOCUMENT_STATUS: {
      PENDING: 'pending',
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed'
    },
  
    // Content types
    CONTENT_TYPES: {
      PARAGRAPH: 'paragraph',
      IMAGE: 'image',
      TABLE: 'table'
    },
  
    // File upload limits
    FILE_LIMITS: {
      MAX_SIZE: 50 * 1024 * 1024, // 50MB
      ALLOWED_TYPES: ['application/pdf']
    },
  
    // Search configuration
    SEARCH_CONFIG: {
      MAX_RESULTS: 100,
      DEFAULT_LIMIT: 20,
      MIN_QUERY_LENGTH: 2,
      HIGHLIGHT_TAG: {
        START: '<mark>',
        END: '</mark>'
      }
    },
  
    // Queue configuration
    QUEUE_CONFIG: {
      DOCUMENT_PROCESSING: 'document:processing',
      ATTEMPTS: 3,
      DELAY: 2000, // 2 seconds
      BACKOFF: 'exponential'
    },
  
    // Database tables
    DB_TABLES: {
      DOCUMENTS: 'documents',
      CHUNKS: 'chunks'
    },
  
    // Error codes
    ERROR_CODES: {
      INVALID_FILE: 'INVALID_FILE',
      PROCESSING_FAILED: 'PROCESSING_FAILED',
      DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
      SEARCH_FAILED: 'SEARCH_FAILED',
      UNAUTHORIZED: 'UNAUTHORIZED',
      RATE_LIMITED: 'RATE_LIMITED'
    },
  
    // HTTP status codes
    HTTP_STATUS: {
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      NOT_FOUND: 404,
      UNPROCESSABLE_ENTITY: 422,
      TOO_MANY_REQUESTS: 429,
      INTERNAL_SERVER_ERROR: 500
    }
  };