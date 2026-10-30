import React, { useState, useRef } from 'react';

export default function DocumentManager({
  documents,
  loadingDocs,
  onRefreshDocs,
  onUploadSuccess,
  apiUrl
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // { type: 'success' | 'error', message: string }
  const [isDragging, setIsDragging] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const fileInputRef = useRef(null);

  // Handle PDF file upload via POST /upload
  const handleFileUpload = async (file) => {
    if (!file) return;

    if (!adminKey.trim()) {
      setUploadStatus({ type: 'error', message: 'Enter the document administration key to upload a PDF.' });
      return;
    }

    // Strict client-side validation
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadStatus({
        type: 'error',
        message: 'Only PDF documents are supported.'
      });
      return;
    }

    setUploading(true);
    setUploadStatus(null);

    if (!apiUrl) {
      setUploading(false);
      setUploadStatus({ type: 'error', message: 'Backend URL is not configured. Set VITE_API_URL and rebuild the frontend.' });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${apiUrl}/upload`, {
        method: 'POST',
        headers: { 'X-Document-Admin-Key': adminKey },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to upload and index document.');
      }

      setUploadStatus({
        type: 'success',
        message: Number.isFinite(data.details?.chunks_added)
          ? `Indexed "${file.name}" (${data.details.chunks_added} chunks added)`
          : `Indexed "${file.name}" successfully.`
      });

      // Refresh document list
      if (onUploadSuccess) onUploadSuccess();
    } catch (err) {
      setUploadStatus({
        type: 'error',
        message: err.message || 'Error communicating with server.'
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <aside className="sidebar-panel">
      {/* Upload Guideline Card */}
      <div className="panel-card">
        <div className="panel-card-header">
          <h2 className="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Add Guideline
          </h2>
        </div>

        <label className="document-admin-field">
          <span>Document administration key</span>
          <input
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            autoComplete="new-password"
            aria-label="Document administration key"
            placeholder="Enter key configured on the backend"
          />
        </label>

        {/* Drag & Drop Area */}
        <div
          className={`dropzone ${isDragging ? 'active' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload a PDF guideline"
          aria-disabled={uploading}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => handleFileUpload(e.target.files?.[0])}
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
            disabled={uploading}
          />
          <div className="dropzone-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <p className="dropzone-text">
            {uploading ? 'Uploading & indexing…' : 'Choose or drag a PDF here'}
          </p>
          <p className="dropzone-hint">Accepts medical PDF guidelines</p>
        </div>

        {/* Status notification */}
        {uploadStatus && (
          <div className={`alert-banner ${uploadStatus.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ marginTop: '12px' }}>
            <span>{uploadStatus.message}</span>
          </div>
        )}
      </div>

      {/* Indexed Documents Card */}
      <div className="panel-card">
        <div className="panel-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="panel-title">Guideline PDFs</h2>
            <span className="badge">{documents.length}</span>
          </div>
          <button
            className="btn btn-secondary"
            onClick={onRefreshDocs}
            disabled={loadingDocs}
            style={{ padding: '6px 10px', fontSize: '0.78rem' }}
            title="Refresh document list"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loadingDocs ? 'pulse-spinner' : ''}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Document List */}
        <div className="doc-list">
          {loadingDocs ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>Loading guideline files…</p>
          ) : documents.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              No guideline PDFs are available yet.
            </p>
          ) : (
            documents.map((doc, idx) => {
              const sizeDisplay = doc.size_kb > 1024 
                ? `${(doc.size_kb / 1024).toFixed(1)} MB` 
                : `${Math.round(doc.size_kb)} KB`;

              return (
                <div key={idx} className="doc-item">
                  <div className="doc-info">
                    <span className="doc-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                    <span className="doc-name" title={doc.name}>{doc.name}</span>
                  </div>
                  <span className="doc-size">{sizeDisplay}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
