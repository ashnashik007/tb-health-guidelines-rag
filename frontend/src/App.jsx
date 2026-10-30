import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import DocumentManager from './components/DocumentManager';
import ChatArea from './components/ChatArea';
import Footer from './components/Footer';
import EvaluationDashboard from './components/EvaluationDashboard';

// Keep the existing Vite environment variable and backend routes.
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'ask', label: 'Ask AI', icon: 'chat' },
  { id: 'documents', label: 'Documents', icon: 'file' },
  { id: 'evaluation', label: 'Evaluation', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></>,
    chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2.9z"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

export default function App() {
  const [activePage, setActivePage] = useState('dashboard');
  const [isConnected, setIsConnected] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [loadingEvaluation, setLoadingEvaluation] = useState(false);
  const [evaluationError, setEvaluationError] = useState(null);

  const checkHealth = useCallback(async () => {
    if (!API_BASE_URL) { setIsConnected(false); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
      setIsConnected(res.ok);
    } catch {
      setIsConnected(false);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    if (!API_BASE_URL) { setDocuments([]); setLoadingDocs(false); return; }
    setLoadingDocs(true);
    try {
      const res = await fetch(`${API_BASE_URL}/documents`, { method: 'GET' });
      if (!res.ok) throw new Error('Failed to fetch documents.');
      const data = await res.json();
      setDocuments(data.documents || []);
      setIsConnected(true);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setIsConnected(false);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const fetchEvaluation = useCallback(async () => {
    if (!API_BASE_URL) {
      setEvaluationError('Backend URL is not configured. Set VITE_API_URL and rebuild the frontend.');
      setLoadingEvaluation(false);
      return;
    }
    setLoadingEvaluation(true);
    setEvaluationError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/evaluation`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Evaluation request failed (${response.status}).`);
      if (!data || typeof data.available !== 'boolean' || !Array.isArray(data.test_cases)) {
        throw new Error('The evaluation API returned an invalid response.');
      }
      setEvaluation(data);
    } catch (err) {
      setEvaluationError(err.message || 'Unable to load evaluation results.');
    } finally {
      setLoadingEvaluation(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    fetchDocuments();
    fetchEvaluation();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth, fetchDocuments]);

  const handleSendMessage = async (questionText) => {
    setActivePage('ask');
    setApiError(null);
    setMessages((prev) => [...prev, { sender: 'user', text: questionText, timestamp: new Date().toISOString() }]);
    setLoadingAnswer(true);
    try {
      if (!API_BASE_URL) throw new Error('Backend URL is not configured. Set VITE_API_URL and rebuild the frontend.');
      const res = await fetch(`${API_BASE_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: questionText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Server error (${res.status})`);
      setMessages((prev) => [...prev, {
        sender: 'ai',
        text: data.answer || 'The provided guidelines do not contain enough information to answer this question.',
        sources: data.sources || [],
        timestamp: new Date().toISOString(),
      }]);
      setIsConnected(true);
    } catch (err) {
      console.error('Q&A Request failed:', err);
      setApiError(err.message || 'Unable to connect to the Health Guidelines backend.');
      setIsConnected(false);
    } finally {
      setLoadingAnswer(false);
    }
  };

  const renderDashboard = () => (
    <>
      <PageHeading eyebrow="Workspace overview" title="TB guideline dashboard" description="A clear view of your evidence library and clinical guideline assistant." action={<span className={`connection-pill ${isConnected ? 'connected' : 'disconnected'}`}><i />{isConnected ? 'Backend connected' : 'Backend unavailable'}</span>} />
      <section className="stats-grid" aria-label="Workspace summary">
        <article className="stat-card"><div className="stat-icon blue"><Icon name="file" size={20}/></div><p>Guideline PDFs</p><strong>{loadingDocs ? '…' : documents.length}</strong><span>PDFs available in the data folder</span></article>
        <article className="stat-card"><div className={`stat-icon ${isConnected ? 'green' : 'amber'}`}><span className="live-indicator"/></div><p>Backend status</p><strong className="status-value">{isConnected ? 'Online' : 'Offline'}</strong><span>{isConnected ? 'Ready to answer questions' : 'Check the backend service'}</span></article>
        <article className="stat-card"><div className="stat-icon violet"><Icon name="chat" size={20}/></div><p>Questions this session</p><strong>{messages.filter((message) => message.sender === 'user').length}</strong><span>Conversation is stored in this tab</span></article>
      </section>
      <section className="performance-grid" aria-label="Evaluation performance overview">
        <div className="performance-heading"><div><p className="eyebrow">RAG performance</p><h2>Latest evaluation</h2></div><button className="text-button" onClick={() => setActivePage('evaluation')}>View report →</button></div>
        <div className="performance-metrics">{[
          ['Pass rate', evaluation?.summary?.pass_rate_percent, '%'],
          ['Grounded answer rate', evaluation?.summary?.grounded_answer_rate_percent, '%'],
          ['Citation coverage', evaluation?.summary?.citation_pass_rate_percent, '%'],
          ['Failed cases', evaluation?.summary?.failed_test_cases, ''],
          ['Average response', evaluation?.summary?.average_response_time_sec, ' s'],
          ['Indexed chunks', null, ''],
        ].map(([label, value, suffix]) => <div className="performance-metric" key={label}><span>{label}</span><strong>{loadingEvaluation ? '…' : value == null ? 'Not available' : `${typeof value === 'number' && suffix === '%' ? value.toFixed(1) : typeof value === 'number' && suffix === ' s' ? value.toFixed(2) : value}${suffix}`}</strong></div>)}</div>
        <div className="performance-foot">Last evaluation: {evaluation?.generated_at ? new Date(evaluation.generated_at).toLocaleString() : 'Not available'}</div>
      </section>
      <section className="dashboard-grid">
        <article className="surface-card welcome-panel"><div className="assistant-mark"><Icon name="chat" size={22}/></div><p className="eyebrow">Evidence assistant</p><h2>Ask your guideline library</h2><p>Get answers grounded in your indexed TB health documents, with source filenames and page references alongside each response.</p><button className="button-primary" onClick={() => setActivePage('ask')}>Start a conversation <span aria-hidden="true">→</span></button></article>
        <article className="surface-card recent-docs"><div className="section-heading"><div><p className="eyebrow">Your library</p><h2>Indexed documents</h2></div><button className="text-button" onClick={() => setActivePage('documents')}>View all <span aria-hidden="true">→</span></button></div>
          {loadingDocs ? <div className="inline-state"><span className="spinner"/>Loading documents…</div> : documents.length ? <ul className="recent-list">{documents.slice(0, 4).map((doc, index) => <li key={`${doc.name}-${index}`}><span className="pdf-icon"><Icon name="file" size={18}/></span><span className="recent-name" title={doc.name}>{doc.name}</span><span className="file-type">PDF</span></li>)}</ul> : <div className="empty-state compact"><span className="empty-icon"><Icon name="file" size={20}/></span><strong>No documents indexed</strong><span>Upload a guideline PDF to begin.</span><button className="text-button" onClick={() => setActivePage('documents')}>Open documents</button></div>}
        </article>
      </section>
      <section className="surface-card evaluation-preview"><div className="section-heading"><div><p className="eyebrow">Quality monitoring</p><h2>Evaluation analytics</h2></div><button className="text-button" onClick={() => setActivePage('evaluation')}>Open evaluation <span aria-hidden="true">→</span></button></div><p>{evaluationError || evaluation?.message || (evaluation?.summary ? `${evaluation.summary.total_test_cases} cases in the latest report. Report generated ${new Date(evaluation.generated_at).toLocaleDateString()}.` : 'Evaluation summary is not available.')}</p></section>
    </>
  );

  const renderEvaluation = () => (
    <>
      <PageHeading eyebrow="Quality monitoring" title="Evaluation analytics" description="Review actual outcomes from the latest evaluation CSV report." action={<button className="button-quiet" onClick={fetchEvaluation} disabled={loadingEvaluation}>{loadingEvaluation ? 'Refreshing…' : 'Refresh report'}</button>} />
      <EvaluationDashboard data={evaluation} loading={loadingEvaluation} error={evaluationError} onRetry={fetchEvaluation}/>
    </>
  );

  const renderSettings = () => (
    <>
      <PageHeading eyebrow="Workspace configuration" title="Settings" description="Review the frontend connection details for this workspace." />
      <section className="surface-card settings-card"><div className="section-heading"><div><p className="eyebrow">Connection</p><h2>Backend service</h2></div><span className={`connection-pill ${isConnected ? 'connected' : 'disconnected'}`}><i />{isConnected ? 'Connected' : 'Disconnected'}</span></div><div className="setting-row"><div><strong>API base URL</strong><p>Configured through the Vite environment variable.</p></div><code>{API_BASE_URL}</code></div><div className="setting-row"><div><strong>Health check</strong><p>Connection status refreshes every 30 seconds.</p></div><span className="setting-readout">{isConnected ? 'Available' : 'Unavailable'}</span></div><div className="setting-row"><div><strong>ChromaDB</strong><p>The current health endpoint does not report database availability.</p></div><span className="setting-readout">Not available</span></div><div className="setting-row"><div><strong>Groq configuration</strong><p>Secret configuration status is not exposed by the current health endpoint.</p></div><span className="setting-readout">Not available</span></div><div className="setting-note">Set <code>VITE_API_URL</code> in the frontend environment to point to your backend. API keys remain server-side and are never displayed here.</div></section>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a href="#dashboard" className="brand-lockup" onClick={(event) => { event.preventDefault(); setActivePage('dashboard'); }}>
          <span className="brand-symbol"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>
          <span><strong>Care<span>Evidence</span></strong><small>TB guideline workspace</small></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => setActivePage(item.id)} aria-current={activePage === item.id ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'documents' && documents.length > 0 && <span className="nav-count">{documents.length}</span>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-status"><span className={`status-avatar ${isConnected ? 'online' : 'offline'}`}><i/></span><span><strong>{isConnected ? 'Service online' : 'Service offline'}</strong><small>Guideline API</small></span><span className={`tiny-dot ${isConnected ? 'online' : ''}`}/></div><div className="sidebar-disclaimer">For evidence review and educational support. Not a substitute for clinical judgment.</div></div>
      </aside>
      <div className="app-main"><Header isConnected={isConnected}/><main className="workspace-content">
        {activePage === 'dashboard' && renderDashboard()}
        {activePage === 'ask' && <><PageHeading eyebrow="Clinical evidence assistant" title="Ask AI" description="Ask a question and review the supporting guideline passages." action={messages.length > 0 && <button className="button-quiet" onClick={() => { setMessages([]); setApiError(null); }}>Clear conversation</button>} /><ChatArea messages={messages} loading={loadingAnswer} error={apiError} onSendMessage={handleSendMessage} onClearChat={() => { setMessages([]); setApiError(null); }}/></>}
        {activePage === 'documents' && <><PageHeading eyebrow="Evidence library" title="Documents" description="Upload and manage the PDF guidelines indexed by your assistant."/><DocumentManager documents={documents} loadingDocs={loadingDocs} onRefreshDocs={fetchDocuments} onUploadSuccess={fetchDocuments} apiUrl={API_BASE_URL}/></>}
        {activePage === 'evaluation' && renderEvaluation()}
        {activePage === 'settings' && renderSettings()}
      </main><Footer/></div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.map((item) => <button key={item.id} className={activePage === item.id ? 'active' : ''} onClick={() => setActivePage(item.id)} aria-label={item.label} aria-current={activePage === item.id ? 'page' : undefined}><Icon name={item.icon} size={20}/><span>{item.label}</span></button>)}</nav>
    </div>
  );
}
