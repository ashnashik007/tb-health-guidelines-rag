import React, { useMemo, useState } from 'react';

const PASS_STATUSES = new Set([
  'PASSED_STRICT_FALLBACK',
  'PASSED_GROUNDED_WITH_CITATION',
  'PASSED_REQUIRES_CLINICAL_AUDIT',
  'PASSED_EXPECTED_SOURCE_MATCH',
  'PASSED_SOURCE_MATCH_REQUIRES_CLINICAL_AUDIT',
]);

function statusLabel(status) {
  return (status || 'STATUS_MISSING').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusPill({ status }) {
  const kind = PASS_STATUSES.has(status) ? 'passed' : status === 'EXECUTION_ERROR' ? 'error' : 'failed';
  return <span className={`result-pill ${kind}`}>{statusLabel(status)}</span>;
}

function BarChart({ title, rows, maxValue, valueLabel = 'count', colors = ['#2f6ddd', '#e27b70'] }) {
  return <section className="eval-chart-card"><h3>{title}</h3>{!rows?.length ? <div className="chart-no-data">No data available</div> : <div className="bar-chart" role="img" aria-label={`${title} chart`}>
    {rows.map((row, index) => {
      const value = row.count ?? row.total ?? 0;
      const passed = row.passed ?? value;
      const failed = row.failed ?? 0;
      return <div className="bar-row" key={row.label || row.category || index}>
        <span className="bar-label" title={row.label || row.category}>{row.label || row.category}</span>
        <div className="bar-track" aria-label={`${value} ${valueLabel}`}>
          {row.passed != null ? <><i className="bar-segment pass" style={{ width: `${maxValue ? passed / maxValue * 100 : 0}%`, background: colors[0] }}/><i className="bar-segment fail" style={{ width: `${maxValue ? failed / maxValue * 100 : 0}%`, background: colors[1] }}/></> : <i className="bar-single" style={{ width: `${maxValue ? value / maxValue * 100 : 0}%`, background: colors[index % colors.length] }}/ >}
        </div>
        <strong className="bar-value">{row.passed != null ? `${passed} / ${failed}` : value}</strong>
      </div>;
    })}
  </div>}</section>;
}

export default function EvaluationDashboard({ data, loading, error, onRetry }) {
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('test_id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedId, setExpandedId] = useState(null);

  const cases = data?.test_cases || [];
  const staleFallbackCount = cases.filter((item) => item.evaluation_status === 'FAILED_HALLUCINATION_DETECTED'
    && (item.actual_answer || '').trim().toLocaleLowerCase() === 'the provided guidelines do not contain enough information to answer this question.').length;
  const categories = data?.category_counts || [];
  const summary = data?.summary;
  const filteredCases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return cases.filter((item) => {
      const isPassed = PASS_STATUSES.has(item.evaluation_status);
      const matchesResult = resultFilter === 'all' || (resultFilter === 'passed' ? isPassed : !isPassed);
      const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
      const matchesSearch = !query || [item.test_id, item.category, item.question, item.expected_answer, item.actual_answer, item.retrieved_sources, item.evaluation_status]
        .some((value) => String(value || '').toLocaleLowerCase().includes(query));
      return matchesResult && matchesCategory && matchesSearch;
    }).sort((a, b) => {
      const first = a[sortBy];
      const second = b[sortBy];
      const comparison = typeof first === 'number' && typeof second === 'number'
        ? first - second
        : String(first ?? '').localeCompare(String(second ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [cases, search, resultFilter, categoryFilter, sortBy, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredCases.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleCases = filteredCases.slice((safePage - 1) * pageSize, safePage * pageSize);

  const citationRows = data ? [
    { label: 'Citation pass', count: data.citation_counts?.pass || 0 },
    { label: 'Citation fail', count: data.citation_counts?.fail || 0 },
    { label: 'Not applicable', count: data.citation_counts?.not_applicable || 0 },
    { label: 'Other', count: data.citation_counts?.other || 0 },
  ] : [];
  const maxOutcome = summary?.total_test_cases || 0;
  const maxCitation = Math.max(1, ...citationRows.map((row) => row.count));
  const statusDescriptions = {
    PASSED_GROUNDED_WITH_CITATION: 'Passed expected source match (legacy status; semantic grounding not checked)',
    PASSED_STRICT_FALLBACK: 'Passed strict fallback',
    PASSED_EXPECTED_SOURCE_MATCH: 'Passed expected source-document match; semantic grounding not checked',
    PASSED_REQUIRES_CLINICAL_AUDIT: 'Passed expected source match (legacy status); clinical audit required',
    PASSED_SOURCE_MATCH_REQUIRES_CLINICAL_AUDIT: 'Passed expected source match; clinical audit required',
    FALSE_NEGATIVE_RETRIEVAL_MISS: 'Failed due to insufficient evidence / retrieval miss',
    FALSE_NEGATIVE_AFTER_EXPECTED_SOURCE_RETRIEVED: 'Failed; expected PDF retrieved but answer declined',
    FAILED_HALLUCINATION_DETECTED: 'Failed ungrounded answer',
    CITATION_MISMATCH: 'Citation failure',
    MISSING_CITATION: 'Missing citation',
    RETRIEVAL_ERROR: 'Vector retrieval error',
    PROVIDER_ACCESS_ERROR: 'LLM provider access error',
    EXECUTION_ERROR: 'Execution error',
  };

  if (loading && !data) return <div className="surface-card eval-state"><span className="spinner"/> Loading evaluation report…</div>;
  if (error && !data) return <div className="surface-card eval-state eval-error"><h2>Could not load evaluation results</h2><p>{error}</p><button className="button-primary" onClick={onRetry}>Try again</button></div>;
  if (!data?.available || !summary) return <div className="surface-card eval-state"><div className="empty-chart">◎</div><h2>{data?.reason === 'empty_report' ? 'Evaluation report is empty' : data?.reason === 'report_missing' ? 'Evaluation report not found' : 'Evaluation data unavailable'}</h2><p>{error || data?.message || 'The evaluation endpoint did not return a report.'}</p><p className="eval-command-help">To generate results, run the existing evaluation script from PowerShell:</p><code className="command-block">cd "D:\New folder\health-rag"<br/>&amp; ".\backend\venv\Scripts\python.exe" ".\evaluation\evaluate.py"</code><button className="button-quiet" onClick={onRetry} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh report'}</button></div>;

  const toggleSort = (key) => {
    if (sortBy === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDirection('asc'); }
    setPage(1);
  };

  return <div className="evaluation-content">
    {error && <div className="alert-banner alert-danger eval-inline-error"><span>Could not refresh report: {error}. Showing the last loaded report.</span></div>}
    {staleFallbackCount > 0 && <div className="alert-banner alert-warning eval-inline-error" role="status"><span><strong>Report classification mismatch:</strong> {staleFallbackCount} row(s) are labeled as hallucinations although the recorded answer is the current insufficient-evidence response. The dashboard preserves CSV statuses. Run the evaluation script again to refresh the classification with the updated detector.</span></div>}
    <section className="eval-summary-grid" aria-label="Evaluation summary">
      {[
        ['Test cases', summary.total_test_cases, 'in latest report'],
        ['Passed cases', summary.passed_test_cases, 'recognized pass statuses'],
        ['Failed cases', summary.failed_test_cases, 'including unknown outcomes'],
        ['Pass rate', summary.pass_rate_percent == null ? null : `${summary.pass_rate_percent.toFixed(1)}%`, 'passed / all cases'],
        ['Citation pass', summary.citation_pass_rate_percent == null ? null : `${summary.citation_pass_rate_percent.toFixed(1)}%`, `${summary.citation_pass_count} pass · ${summary.citation_fail_count} fail`],
        ['Avg. response', summary.average_response_time_sec == null ? null : `${summary.average_response_time_sec.toFixed(2)} s`, 'valid measured rows'],
      ].map(([label, value, detail]) => <article className="eval-stat" key={label}><span>{label}</span><strong>{value == null ? 'Not available' : value}</strong><small>{detail}</small></article>)}
    </section>

    <section className="eval-charts-grid" aria-label="Evaluation charts">
      <section className="eval-chart-card"><h3>Passed vs failed cases</h3><div className="outcome-visual" role="img" aria-label={`${summary.passed_test_cases} passed, ${summary.failed_test_cases} failed`}><div className="outcome-track"><span className="outcome-pass" style={{ width: `${summary.total_test_cases ? summary.passed_test_cases / summary.total_test_cases * 100 : 0}%` }}/><span className="outcome-fail" style={{ width: `${summary.total_test_cases ? summary.failed_test_cases / summary.total_test_cases * 100 : 0}%` }}/></div><div className="chart-legend"><span><i className="legend-pass"/>Passed <b>{summary.passed_test_cases}</b></span><span><i className="legend-fail"/>Failed <b>{summary.failed_test_cases}</b></span></div></div></section>
      <BarChart title="Outcomes by category · pass / fail" rows={categories} maxValue={maxOutcome}/>
      <BarChart title="Response time distribution" rows={data.response_time_distribution} maxValue={Math.max(1, ...data.response_time_distribution.map((row) => row.count))} colors={['#6895e7', '#4779d5', '#3866c2']}/>
      <BarChart title="Citation verification results" rows={citationRows} maxValue={maxCitation} colors={['#28a37c', '#dc746b', '#a8b3c2', '#7485a0']}/>
    </section>

    <section className="surface-card status-breakdown"><div className="section-heading"><div><p className="eyebrow">Raw report outcomes</p><h2>Evaluation status</h2></div><span className="report-date">Report: {data.generated_at ? new Date(data.generated_at).toLocaleString() : 'date unavailable'}</span></div><div className="status-breakdown-grid">{Object.entries(data.status_counts || {}).map(([status, count]) => <div className="status-breakdown-item" key={status}><StatusPill status={status}/><span>{statusDescriptions[status] || 'Other outcome (unclassified)'}</span><strong>{count}</strong></div>)}</div><p className="status-note">Statuses are shown as recorded in the CSV. Unknown status values are included in the failed count and are never treated as passed.</p></section>

    <section className="surface-card eval-table-card"><div className="section-heading table-heading"><div><p className="eyebrow">Case-level detail</p><h2>Test cases <span className="table-count">{filteredCases.length}</span></h2></div><label className="search-control"><span className="sr-only">Search evaluation cases</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search cases…"/></label></div>
      <div className="table-filters"><label>Result<select value={resultFilter} onChange={(event) => { setResultFilter(event.target.value); setPage(1); }}><option value="all">All results</option><option value="passed">Passed</option><option value="failed">Failed / other</option></select></label><label>Category<select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}><option value="all">All categories</option>{categories.map((item) => <option key={item.category} value={item.category}>{item.category}</option>)}</select></label><label>Sort by<select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}><option value="test_id">Test ID</option><option value="category">Category</option><option value="evaluation_status">Evaluation status</option><option value="response_time_sec">Response time</option></select></label><button className="sort-direction" onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')} aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}>{sortDirection === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</button></div>
      <div className="eval-table-scroll"><table className="eval-table"><thead><tr><th><button onClick={() => toggleSort('test_id')}>Test ID ↕</button></th><th>Question</th><th>Expected answer / reference</th><th>Actual answer</th><th>Retrieved source</th><th><button onClick={() => toggleSort('citation_match')}>Citation ↕</button></th><th><button onClick={() => toggleSort('evaluation_status')}>Evaluation result ↕</button></th><th><button onClick={() => toggleSort('response_time_sec')}>Time ↕</button></th><th>Details</th></tr></thead><tbody>
        {visibleCases.map((item) => <React.Fragment key={item.test_id}><tr><td className="test-id">{item.test_id}</td><td className="truncate-cell" title={item.question}>{item.question || '—'}</td><td className="truncate-cell" title={item.expected_answer || item.verified_page_or_passage}>{item.expected_answer || item.verified_page_or_passage || '—'}</td><td className="truncate-cell" title={item.actual_answer}>{item.actual_answer || '—'}</td><td className="truncate-cell" title={item.retrieved_sources}>{item.retrieved_sources || '—'}</td><td><span className={`citation-pill ${item.citation_match?.toUpperCase().startsWith('PASS') ? 'citation-pass' : item.citation_match?.toUpperCase().startsWith('FAIL') ? 'citation-fail' : 'citation-na'}`}>{item.citation_match || 'Unknown'}</span></td><td><StatusPill status={item.evaluation_status}/></td><td>{item.response_time_sec == null ? '—' : `${item.response_time_sec.toFixed(2)} s`}</td><td><button className="expand-row" onClick={() => setExpandedId((current) => current === item.test_id ? null : item.test_id)} aria-expanded={expandedId === item.test_id}>{expandedId === item.test_id ? 'Hide' : 'View'}</button></td></tr>
          {expandedId === item.test_id && <tr className="expanded-row"><td colSpan="9"><div className="expanded-details"><div><span>Category</span><p>{item.category || 'Not recorded'}</p></div><div><span>Guideline version</span><p>{item.guideline_version || 'Not available in dataset'}</p></div><div><span>Expected source</span><p>{item.expected_source_document || 'Not recorded'} · {item.verified_page_or_passage || 'No page reference recorded'}</p></div><div><span>Full expected answer</span><p>{item.expected_answer || 'Not available in dataset.'}</p></div><div><span>Full actual answer</span><p>{item.actual_answer || 'No answer recorded.'}</p></div><div><span>Retrieved source(s)</span><p>{item.retrieved_sources || 'No sources recorded.'}</p></div><div><span>Citation result</span><p>{item.citation_match || 'Not recorded'}</p></div><div><span>Grounding verification</span><p>{item.expected_behavior === 'STRICT_FALLBACK' ? 'Fallback wording checked against expected behavior.' : 'Semantic support of answer claims is not evaluated by this script.'}</p></div><div><span>Clinical verification</span><p>{item.needs_clinical_verification || 'Not recorded'}</p></div>{item.error_detail && <div className="error-detail"><span>Error detail</span><p>{item.error_detail}</p></div>}</div></td></tr>}
        </React.Fragment>)}
        {!visibleCases.length && <tr><td colSpan="9" className="no-table-results">No test cases match these filters.</td></tr>}
      </tbody></table></div>
      <div className="table-pagination"><span>Showing {filteredCases.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filteredCases.length)} of {filteredCases.length}</span><label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>10</option><option>25</option><option>50</option></select></label><div><button disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {safePage} of {pageCount}</span><button disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button></div></div>
    </section>
    <p className="eval-run-help">Evaluation is read-only here. Run the existing <code>evaluation/evaluate.py</code> script manually to create a new report, then refresh this page. This avoids launching duplicate evaluation runs from the browser.</p>
  </div>;
}
