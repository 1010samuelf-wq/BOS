// The assistant: a side panel available from every page.
//
// It can answer questions on its own, but it cannot change anything. When a
// change is wanted the server sends back a *proposal* and this panel shows the
// exact sentence describing it with Confirm / Cancel. Nothing is written until
// that button is pressed — the model never gets to act by itself.
//
// Conversations live on the server, keyed to the signed-in employee, so a
// reload no longer loses the thread and past chats can be reopened. Only the
// new message is sent; the server holds the history.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  assistantAct,
  assistantChat,
  assistantConversation,
  assistantConversations,
  assistantStatus,
  deleteAssistantConversation,
} from "../api/endpoints";
import type { AssistantProposal, ChatTurn } from "../api/types";
import { formatDateTime } from "../order/dates";

/** Renders the assistant's markdown: tables, bold, lists, code.
 *
 * Raw HTML is deliberately NOT enabled (no rehype-raw). Everything here is
 * model output, and letting it inject markup would be an XSS hole; react-markdown
 * escapes HTML by default, so the worst a bad reply can do is look odd.
 *
 * The panel is narrow, so a wide table scrolls sideways inside its own box
 * rather than stretching the whole conversation.
 */
function Markdown({ text }: { text: string }) {
  return (
    <div className="assistant-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="assistant-md-table">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A turn as shown on screen. `done` lines are local receipts, not model output. */
interface Line extends ChatTurn {
  done?: boolean;
}

const GREETING =
  "Ask me about orders, sales, the bake list, deliveries or hours. " +
  "I can also take an order, log an expense or tick off a task — I'll show you " +
  "exactly what I'm about to do and wait for your OK.";

export default function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  // Which item of a batch is running, so progress is visible rather than
  // the whole panel freezing on "Doing it…".
  const [runningIdx, setRunningIdx] = useState<number | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Hidden entirely when the server has no API key configured.
  const status = useQuery({ queryKey: ["assistant", "status"], queryFn: assistantStatus });

  const history = useQuery({
    queryKey: ["assistant", "conversations"],
    queryFn: assistantConversations,
    enabled: open && showHistory,
  });

  const ask = useMutation({
    mutationFn: (text: string) => assistantChat(text, conversationId),
    onSuccess: (out) => {
      setConversationId(out.conversation_id);
      if (out.reply) setLines((cur) => [...cur, { role: "assistant", text: out.reply }]);
      setProposals(out.proposals);
      queryClient.invalidateQueries({ queryKey: ["assistant", "conversations"] });
    },
  });

  const openPast = useMutation({
    mutationFn: (id: number) => assistantConversation(id),
    onSuccess: (convo) => {
      setConversationId(convo.id);
      setLines(convo.messages);
      setProposals([]);
      setShowHistory(false);
      ask.reset();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteAssistantConversation(id),
    onSuccess: (_out, id) => {
      if (id === conversationId) newChat();
      queryClient.invalidateQueries({ queryKey: ["assistant", "conversations"] });
    },
  });

  /** Run an approved batch one item at a time.
   *
   * Sequential rather than parallel, and it stops at the first failure: each
   * item is a real change to shop data, and carrying on after one fails would
   * leave a half-applied batch nobody can reason about. Whatever already ran is
   * reported as done, because it did.
   */
  async function confirmAll() {
    setBatchError(null);
    const done: string[] = [];
    for (let i = 0; i < proposals.length; i++) {
      setRunningIdx(i);
      try {
        const out = await assistantAct(proposals[i].action, proposals[i].args);
        done.push(out.result);
      } catch {
        setRunningIdx(null);
        setLines((cur) => [
          ...cur,
          ...done.map((text) => ({ role: "user" as const, text, done: true })),
        ]);
        setProposals([]);
        setBatchError(
          done.length
            ? `${done.length} of ${proposals.length} changes went through; the rest didn't.`
            : "That didn't go through. Nothing was changed.",
        );
        queryClient.invalidateQueries();
        return;
      }
    }
    setRunningIdx(null);
    setProposals([]);
    setLines((cur) => [
      ...cur,
      ...done.map((text) => ({ role: "user" as const, text, done: true })),
    ]);
    // Real data changed — let every open screen refetch.
    queryClient.invalidateQueries();
  }

  useEffect(() => {
    if (open && !showHistory) boxRef.current?.focus();
  }, [open, showHistory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, proposals, ask.isPending]);

  function newChat() {
    setConversationId(null);
    setLines([]);
    setProposals([]);
    setBatchError(null);
    setDraft("");
    setShowHistory(false);
    ask.reset();
  }

  function send() {
    const text = draft.trim();
    if (!text || ask.isPending) return;
    setLines((cur) => [...cur, { role: "user", text }]);
    setDraft("");
    setProposals([]);
    setBatchError(null);
    ask.mutate(text);
  }

  if (!status.data?.enabled) return null;

  if (!open) {
    return (
      <button className="assistant-fab" onClick={() => setOpen(true)} title="Ask the assistant">
        ✨ Ask
      </button>
    );
  }

  return (
    <div className="assistant-panel">
      <div className="assistant-head">
        <strong>{showHistory ? "Past chats" : "Assistant"}</strong>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn neutral sm" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Back" : "History"}
          </button>
          <button className="btn neutral sm" onClick={newChat} disabled={lines.length === 0}>
            New chat
          </button>
          <button className="btn neutral sm" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>

      {showHistory ? (
        <div className="assistant-log">
          {history.isLoading && <p className="muted">Loading…</p>}
          {history.data?.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>No saved chats yet.</p>
          )}
          {history.data?.map((c) => (
            <div key={c.id} className="assistant-history-row">
              <button className="assistant-history-open" onClick={() => openPast.mutate(c.id)}>
                <div className="assistant-history-title">{c.title}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {formatDateTime(new Date(c.updated_at))}
                </div>
              </button>
              <button
                className="btn neutral sm"
                title="Delete this chat"
                disabled={remove.isPending}
                onClick={() => remove.mutate(c.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="assistant-log" ref={scrollRef}>
            {lines.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{GREETING}</p>}

            {lines.map((l, i) => (
              <div key={i} className={`assistant-msg ${l.done ? "receipt" : l.role}`}>
                {l.done ? (
                  `✓ ${l.text}`
                ) : l.role === "assistant" ? (
                  // Only the assistant's side is markdown. What the person typed
                  // is shown verbatim — their asterisks are asterisks.
                  <Markdown text={l.text} />
                ) : (
                  l.text
                )}
              </div>
            ))}

            {ask.isPending && <div className="assistant-msg assistant muted">Thinking…</div>}

            {ask.isError && (
              <div className="assistant-msg assistant tone-low">
                Couldn't reach the assistant. Your question was saved — try again.
              </div>
            )}

            {batchError && (
              <div className="assistant-msg assistant tone-low">{batchError}</div>
            )}

            {proposals.length > 0 && (
              <div className="assistant-proposal">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {proposals.length === 1
                    ? "Confirm this change"
                    : `Confirm these ${proposals.length} changes`}
                </div>
                {/* Every item spelled out: approving a batch should never mean
                    approving something you haven't read. */}
                <ol className="assistant-proposal-list">
                  {proposals.map((p, i) => (
                    <li key={i} className={runningIdx === i ? "running" : undefined}>
                      {p.summary}
                      {runningIdx === i && <span className="muted"> — doing this…</span>}
                    </li>
                  ))}
                </ol>
                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                  <button
                    className="btn neutral sm"
                    disabled={runningIdx !== null}
                    onClick={() => setProposals([])}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary sm"
                    disabled={runningIdx !== null}
                    onClick={() => void confirmAll()}
                  >
                    {runningIdx !== null
                      ? `Doing ${runningIdx + 1} of ${proposals.length}…`
                      : proposals.length === 1 ? "Confirm" : `Confirm all ${proposals.length}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="assistant-compose">
            <textarea
              ref={boxRef}
              className="input"
              rows={2}
              maxLength={4000}
              placeholder="Ask about orders, sales, deliveries…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                // Enter sends; Shift+Enter makes a new line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn primary" disabled={!draft.trim() || ask.isPending} onClick={send}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
