import React from 'react';

export default function Header({ isConnected }) {
  return (
    <header className="app-header">
      <div className="header-container">
        <div className="header-branding">
          <div className="brand-icon">
            {/* Professional Medical Cross / Pulse Icon */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div>
            <h1 className="brand-title">Health Guidelines AI</h1>
            <p className="brand-subtitle">Evidence-based answers from trusted healthcare guidelines</p>
          </div>
        </div>

        {/* Backend Connection Indicator */}
        <div className="header-status">
          <span className={`status-dot ${isConnected ? 'online' : 'offline'}`}></span>
          <span>{isConnected ? 'Backend Connected' : 'Backend Disconnected'}</span>
        </div>
      </div>
    </header>
  );
}
