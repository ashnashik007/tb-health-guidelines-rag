import React from 'react';

export default function Footer() {
  return (
    <footer className="app-footer">
      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--primary)' }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p>
          <strong>Clinical Disclaimer:</strong> Health Guidelines AI provides guideline-based educational information and does not replace professional medical judgment, diagnosis, or treatment.
        </p>
      </div>
    </footer>
  );
}
