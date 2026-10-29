import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { timeAgo } from '../../lib/format.js';
import { PriorityBadge } from '../Badges.jsx';
import { ErrorMessage, Spinner } from '../Feedback.jsx';

// Retrying cannot fix a missing server configuration, so no "Try again" for it.
const NOT_RETRYABLE = new Set(['AI_NOT_CONFIGURED']);

function describeContext({ messagesIncluded, messagesTotal }) {
  if (messagesTotal === 0) return 'Based on the ticket (no conversation yet)';
  if (messagesIncluded === messagesTotal) return `Based on the ticket and all ${messagesTotal} conversation messages`;
  return `Based on the ticket and the latest ${messagesIncluded} of ${messagesTotal} conversation messages`;
}

/**
 * AI Support Copilot: asks the server for a recommendation and shows it for the agent
 * to review. It never changes the ticket. The result lives only in this component.
 */
export function CopilotPanel({ ticket }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false); // blocks double clicks before React re-renders
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function analyze() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const { data } = await api.analyzeTicket(ticket.id);
      if (mountedRef.current) setResult(data);
    } catch (err) {
      if (mountedRef.current) setError(err);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setRunning(false);
    }
  }

  const stale = result && result.ticketUpdatedAt !== ticket.updatedAt;
  const canRetry = error && !NOT_RETRYABLE.has(error.code);

  return (
    <section className="card copilot" aria-labelledby="copilot-title" aria-busy={running}>
      <div className="panel-head">
        <div className="panel-title-icon">
          <span className="icon-chip tone-accent" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <div>
            <h2 id="copilot-title">AI Support Copilot</h2>
            <p className="panel-desc">Suggestions for you to review. The ticket isn't changed.</p>
          </div>
        </div>
        {result ? (
          <button type="button" className="btn btn-small" onClick={analyze} disabled={running}>
            <RefreshCw size={14} className={running ? 'spin' : ''} aria-hidden="true" />
            {running ? 'Analyzing…' : 'Analyze again'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-small" onClick={analyze} disabled={running}>
            <Sparkles size={14} aria-hidden="true" />
            {running ? 'Analyzing…' : 'Analyze ticket'}
          </button>
        )}
      </div>


      {running && (
        <p className="copilot-status muted small" role="status">
          <Spinner small /> Reading the ticket and conversation. This can take a few seconds.
        </p>
      )}

      {error && <ErrorMessage error={error} onRetry={canRetry && !running ? analyze : undefined} />}

      {result && (
        <div className={`copilot-result${running ? ' is-refreshing' : ''}`}>
          {stale && (
            <div className="alert alert-info">
              <span>The ticket changed after this analysis.</span>
              <button type="button" className="btn btn-small" onClick={analyze} disabled={running}>
                Analyze again
              </button>
            </div>
          )}

          <dl className="copilot-fields">
            <dt>Ticket summary</dt>
            <dd>{result.summary}</dd>

            <dt>Classification</dt>
            <dd>
              {result.category} <span className="muted">›</span> {result.subcategory}
            </dd>

            <dt>Customer sentiment</dt>
            <dd>
              <span className={`badge sentiment sentiment-${result.sentiment}`}>{result.sentiment}</span>
            </dd>

            <dt>Suggested priority</dt>
            <dd>
              <div className="copilot-priority">
                <span className="suggested-priority" title="AI suggestion, not applied">
                  <PriorityBadge priority={result.suggestedPriority} />
                  <span className="suggestion-tag">Suggestion</span>
                </span>
                <span className="muted small">
                  Current priority: <PriorityBadge priority={ticket.priority} />
                </span>
              </div>
              <div className="muted small">
                {result.suggestedPriority === ticket.priority
                  ? 'Matches the current priority.'
                  : 'Not applied. Change it under Properties if you agree.'}
              </div>
            </dd>

            <dt>Recommended next action</dt>
            <dd>{result.recommendedAction}</dd>

            <dt>Why this was recommended</dt>
            <dd>{result.reasoning}</dd>
          </dl>

          <p className="muted small copilot-footer">
            {describeContext(result.context)} · generated {timeAgo(result.generatedAt)}. AI can be wrong; check before
            acting.
          </p>
        </div>
      )}
    </section>
  );
}
