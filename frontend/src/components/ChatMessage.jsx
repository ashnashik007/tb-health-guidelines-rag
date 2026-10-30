import React, { useState } from 'react';

// Formats plain text safely into paragraphs and bullet lists without dangerouslySetInnerHTML
function FormattedContent({ content }) {
  if (!content) return null;

  // Split content by lines
  const lines = content.split('\n');
  const renderedElements = [];
  let currentListItems = [];

  const flushList = () => {
    if (currentListItems.length > 0) {
      renderedElements.push(
        <ul key={`list-${renderedElements.length}`} style={{ paddingLeft: '20px', margin: '8px 0' }}>
          {currentListItems.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '4px' }}>
              {formatInlineFormatting(item)}
            </li>
          ))}
        </ul>
      );
      currentListItems = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Check for bullet points (* or -)
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      currentListItems.push(trimmed.slice(2));
    } else if (trimmed === '') {
      flushList();
    } else {
      flushList();
      renderedElements.push(
        <p key={`p-${index}`} style={{ margin: '6px 0' }}>
          {formatInlineFormatting(trimmed)}
        </p>
      );
    }
  });

  flushList();

  return <div>{renderedElements}</div>;
}

// Helper to safely format **bold** text inline
function formatInlineFormatting(text) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function ChatMessage({ message }) {
  const isUser = message.sender === 'user';
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sources = message.sources || [];
  const isInsufficient = !isUser && /provided guidelines do not contain enough information|couldn't find this in the provided guidelines/i.test(message.text || '');

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(message.text || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`message-item ${isUser ? 'user' : 'ai'}`}>
      <div className={`message-avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`}>
        {isUser ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        )}
      </div>

      <div className="message-bubble">
        {isUser ? (
          <p>{message.text}</p>
        ) : (
          <div>
            {isInsufficient && <div className="evidence-warning" role="status"><strong>Insufficient evidence</strong><span>The retrieved guidelines do not support an answer to this question.</span></div>}
            <FormattedContent content={message.text} />
            <button className="copy-answer" onClick={copyAnswer} aria-label="Copy answer">{copied ? 'Copied' : 'Copy answer'}</button>

            {/* Citations and Sources Section */}
            {sources.length > 0 && (
              <div className="sources-accordion">
                <button
                  className="sources-toggle"
                  onClick={() => setSourcesOpen(!sourcesOpen)}
                  aria-expanded={sourcesOpen}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: sourcesOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease'
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span>
                    {sourcesOpen ? 'Hide Evidence Sources' : `View ${sources.length} Evidence Sources`}
                  </span>
                </button>

                {sourcesOpen && (
                  <div className="sources-list">
                    {sources.map((src, idx) => (
                      <div key={idx} className="source-card">
                        <div className="source-meta">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span>{src.file}</span>
                          <span className="source-page-badge">Page {src.page}</span>
                        </div>
                        {src.snippet && (
                          <p className="source-snippet">"{src.snippet}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!isInsufficient && sources.length === 0 && <div className="evidence-warning neutral" role="note"><strong>No source citations returned</strong><span>Review this answer cautiously; no supporting document passages were provided.</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}
