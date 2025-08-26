# PDF Search Service

A high-performance Node.js application that enables intelligent search across unstructured PDF data including text paragraphs, images, and tables.

## 🏗️ Architecture Overview

### Data Flow
```
PDF → Parser → ETL Pipeline → Search Index → Search API → Results
```

### Core Components
- **PDF Parser**: Extracts paragraphs, images, and tables from PDF documents (not implemented, assuming we have this already)
- **ETL Pipeline**: Processes and transforms extracted data for search indexing
- **Search Engine**: Document-scoped search within individual PDFs
- **REST API**: Secure endpoints for document upload and search operations

## 🛠️ Technology Stack

### Backend Technologies
- **Node.js** with Express.js framework
- **MeiliSearch** - Fast, typo-tolerant search engine
- **Redis** - Caching and rate limiting
- **SQLite** - Document metadata storage
- **Bull Queue** - Async job processing

### Text Processing & AI
- **Tesseract.js** - OCR for image text extraction
- **Natural** - Text processing and normalization
- **Joi** - Input validation

### Security
- API key authentication
- Rate limiting with express-rate-limit
- CORS configuration
- Helmet.js security headers

## 🌐 Cloud Services Required

### Core Infrastructure
- **Compute Service**: AWS EC2
For running your Node.js application, I would use an AWS EC2 instance. 
With increasing traffic we can use a nginx reverse proxy setup for laod distribution
With very high traffic we can move on to use AWS Application Load Balancer (ALB).
- **PDF File Storage**: AWS S3
For storing original PDF files, I would use a Object storage service like AWS S3, which would be cost effective and give us 
built-in CDN integration for faster global access to PDFs.
- **Redis**: AWS ElastiCache
We can run a self managed Redis cluster on the EC2 instances initially.
With high traffic we can move to a managed redis service like AWS ElastiCache.


## 🚀 Key Features

### Search Capabilities
- **Full-text search** across paragraphs, images (OCR), and tables
- **Typo-tolerant** search with fuzzy matching
- **Content filtering** by type (paragraph/image/table)
- **Fast response times** with document-scoped indexing

### Processing Features
- **Async processing** with job queues
- **OCR integration** for image text extraction
- **Table content flattening** for searchability

### Performance & Scalability
- **Single document focus** for optimized performance
- **Efficient indexing** with MeiliSearch
- **Redis caching** for frequently accessed data
- **Rate limiting** to prevent abuse

## 🔒 Security Features

- **API Key Authentication** - Secure access control
- **Rate Limiting** - Prevents API abuse
- **Input Validation** - Sanitizes all inputs
- **CORS Protection** - Configurable cross-origin policies
- **Security Headers** - HTTP security best practices
