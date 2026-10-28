import { useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { LIMITS } from '../../lib/constants.js';
import { Spinner } from '../Feedback.jsx';

const MODES = {
  reply: { tab: 'Public reply', placeholder: 'Write a reply to the customer…', submit: 'Send reply' },
  note: { tab: 'Internal note', placeholder: 'Note for the team (customers never see this)', submit: 'Add internal note' },
};

// Retrying cannot fix these, so no "Try again" for them.
const NOT_RETRYABLE = new Set(['AI_NOT_CONFIGURED', 'NOT_FOUND', 'UNAUTHORIZED', 'TOO_LONG_TO_ADD']);

/**
 * Public replies and internal notes keep separate text, so an AI-drafted customer reply
 * can never end up saved as a note by switching tabs. The AI Reply Assistant only fills
 * the public-reply box; sending is always the agent's own click on "Send reply".
 */
export function MessageComposer({ ticketId, onAdded }) {
  const [kind, setKind] = useState('reply');
  const [bodies, setBodies] = useState({ reply: '', note: '' });
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const mode = MODES[kind];
  const body = bodies[kind];
  const setBody = (value) => setBodies((prev) => ({ ...prev, [kind]: value }));

  // AI Reply Assistant state. `aiDraft` remembers the text from before the draft was
  // inserted, so "Discard draft" can restore exactly what the agent had written.
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false); // blocks double clicks before React re-renders
  const [choosing, setChoosing] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiDraft, setAiDraft] = useState(null); // { previous, mode }
  const lastRequest = useRef(null);

  async function submit(event) {
    event?.preventDefault();
    if (kind === 'reply' && generating) return;
    if (!body.trim()) {
      setError(kind === 'reply' ? 'Write a reply before sending.' : 'Write a note before saving.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.addMessage(ticketId, { kind, body });
      setBody('');
      if (kind === 'reply') {
        setAiDraft(null);
        setAiError(null);
      }
      await onAdded();
    } catch (err) {
      setError(err.details?.body || err.message);
    } finally {
      setSending(false);
    }
  }

  async function generate(insertMode, previous) {
    if (generatingRef.current) return;
    generatingRef.current = true;
    lastRequest.current = { insertMode, previous };
    setChoosing(false);
    setAiError(null);
    setGenerating(true);
    try {
      const { data } = await api.draftReply(ticketId);
      const text = insertMode === 'append' ? `${previous.trimEnd()}\n\n${data.draft}` : data.draft;
      if (text.length > LIMITS.messageBody) {
        setAiError({
          code: 'TOO_LONG_TO_ADD',
          message: 'Your text plus the AI draft is too long for one reply. Shorten your text or choose "Replace my text".',
        });
        return;
      }
      setBodies((prev) => ({ ...prev, reply: text }));
      setAiDraft({ previous, mode: insertMode });
    } catch (err) {
      setAiError(err);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  function startDraft() {
    if (aiDraft) return generate(aiDraft.mode, aiDraft.previous); // regenerate in place
    if (bodies.reply.trim()) return setChoosing(true); // never overwrite without asking
    return generate('replace', bodies.reply);
  }

  function discardDraft() {
    setBodies((prev) => ({ ...prev, reply: aiDraft.previous }));
    setAiDraft(null);
    setAiError(null);
  }

  const canRetry = aiError && lastRequest.current && !NOT_RETRYABLE.has(aiError.code);

  return (
    <form className={`composer composer-${kind}`} onSubmit={submit} noValidate>
      <div className="composer-tabs" role="tablist" aria-label="Message type">
        {Object.entries(MODES).map(([key, m]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            className={`composer-tab${kind === key ? ' active' : ''} tab-${key}`}
            onClick={() => {
              setKind(key);
              setError(null);
            }}
          >
            {m.tab}
          </button>
        ))}
      </div>

      {kind === 'reply' && (
        <div className="ai-bar" aria-live="polite">
          {aiDraft && !generating ? (
            <>
              <span className="ai-label">AI-generated draft — review and edit before sending.</span>
              <span className="ai-actions">
                <button type="button" className="btn btn-small" onClick={startDraft}>
                  Regenerate
                </button>
                <button type="button" className="btn btn-small btn-link" onClick={discardDraft}>
                  {aiDraft.previous.trim() ? 'Discard draft (restore my text)' : 'Discard draft'}
                </button>
              </span>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-small" onClick={startDraft} disabled={generating || choosing}>
                {generating ? (
                  <>
                    <Spinner small /> Generating draft…
                  </>
                ) : (
                  'Draft with AI'
                )}
              </button>
              <span className="muted small">Nothing is sent until you click Send reply.</span>
            </>
          )}
        </div>
      )}

      {kind === 'reply' && choosing && (
        <div className="ai-choice" role="group" aria-label="Your reply already has text">
          <span>Your reply already has text. What should the AI draft do?</span>
          <span className="ai-actions">
            <button type="button" className="btn btn-small" onClick={() => generate('replace', bodies.reply)}>
              Replace my text
            </button>
            <button type="button" className="btn btn-small" onClick={() => generate('append', bodies.reply)}>
              Add below my text
            </button>
            <button type="button" className="btn btn-small btn-link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {kind === 'reply' && aiError && (
        <div className="alert alert-error ai-error" role="alert">
          <span>
            {aiError.message} You can still write the reply yourself.
          </span>
          {canRetry && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => generate(lastRequest.current.insertMode, lastRequest.current.previous)}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <textarea
        aria-label={mode.tab}
        rows={kind === 'reply' && aiDraft ? 8 : 4}
        maxLength={LIMITS.messageBody}
        placeholder={mode.placeholder}
        value={body}
        readOnly={kind === 'reply' && generating}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      {error && <p className="field-error">{error}</p>}
      <div className="composer-footer">
        <span className="muted small">
          {kind === 'note' ? 'Internal notes are hidden from the customer.' : 'This reply will be visible to the customer.'}{' '}
          Ctrl+Enter to submit.
        </span>
        <button
          type="submit"
          className={`btn ${kind === 'note' ? 'btn-note' : 'btn-primary'}`}
          disabled={sending || (kind === 'reply' && generating)}
        >
          {sending && <Spinner small />} {mode.submit}
        </button>
      </div>
    </form>
  );
}
