import React, { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';

const SUGGESTED_QUESTIONS = [
  "What are the main recommendations for TB treatment?",
  "What support is recommended for people with TB?",
  "What information do the uploaded guidelines provide about tuberculosis?"
];

export default function ChatArea({
  messages,
  loading,
  error,
  onSendMessage,
  onClearChat
}) {
  const [inputQuestion, setInputQuestion] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when messages update or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = inputQuestion.trim();
    if (!trimmed || loading) return;

    onSendMessage(trimmed);
    setInputQuestion('');
  };

  const handleChipClick = (question) => {
    if (loading) return;
    onSendMessage(question);
  };

  return (
    <main className="chat-container">
      {/* Welcome & Prompt Cards Section (Visible when conversation is starting) */}
      <div className="welcome-card">
        <div className="welcome-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Clinical Evidence Assistant
        </div>
        <h2 className="welcome-title">Your Health Guidelines Assistant</h2>
        <p className="welcome-desc">
          Ask questions against indexed WHO and clinical guideline documents. Answers are synthesized strictly from document excerpts with verifiable source citations.
        </p>

        {/* Suggested Question Chips */}
        <div className="chips-container">
          <div className="chips-label">Suggested Inquiries</div>
          <div className="chips-grid">
            {SUGGESTED_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                className="chip-card"
                onClick={() => handleChipClick(q)}
                disabled={loading}
              >
                <span className="chip-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages Conversation Area */}
      <div className="messages-list">
        {messages.map((msg, index) => (
          <ChatMessage key={index} message={msg} />
        ))}

        {/* Loading Indicator */}
        {loading && (
          <div className="message-item ai">
            <div className="message-avatar avatar-ai">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="loading-box">
              <div className="pulse-spinner"></div>
              <span>Searching guidelines and synthesizing evidence...</span>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="alert-banner alert-danger">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <strong>Request Error: </strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="chat-input-bar">
        <form onSubmit={handleSubmit} className="input-form">
          <input
            ref={inputRef}
            type="text"
            className="chat-input"
            aria-label="Ask a question about the indexed TB guidelines"
            placeholder="Type a clinical health question (e.g., What are the treatment regimens for TB?)..."
            value={inputQuestion}
            onChange={(e) => setInputQuestion(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="btn btn-primary"
            aria-label="Send question"
            disabled={loading || !inputQuestion.trim()}
          >
            <span>Send</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  );
}
