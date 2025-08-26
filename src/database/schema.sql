-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    total_pages INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    metadata TEXT, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Document chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_type TEXT NOT NULL CHECK (chunk_type IN ('paragraph', 'image', 'table')),
    content TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    position_data TEXT, -- JSON string for position info
    ocr_confidence REAL, -- For image chunks
    metadata TEXT, -- JSON string for additional metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_documents_upload_time ON documents(upload_time);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_chunks_document_page ON chunks(document_id, page_number);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_documents_timestamp 
    AFTER UPDATE ON documents
    FOR EACH ROW
    BEGIN
        UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;