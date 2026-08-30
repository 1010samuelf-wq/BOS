// The assistant: a side panel available from every page.
//
// It can answer questions on its own, but it cannot change anything. When a
// change is wanted the server sends back a *proposal* and this panel shows the
// exact sentence describing it with Confirm / Cancel. Nothing is written until
// that button is pressed — the model never gets to act by itself.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { assistantAct, assistantChat, assistantStatus } from "../api/endpoints";
import type { AssistantProposal, ChatTurn } from "../api/types";

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
  "I can also mark an order paid or fulfilled — I'll show you exactly what " +
  "I'm about to do and wait for your OK.";

export default function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Hidden entirely when the server has no API key configured.
  const status = useQuery({ queryKey: ["assistant", "status"], queryFn: assistantStatus });

  const ask = useMutation({
    mutationFn: (history: Line[]) =>
      assistantChat(history.map(({ role, text }) => ({ role, text }))),
    onSuccess: (out) => {
      if (out.reply) setLines((cur) => [...cur, { role: "assistant", text: out.reply }]);
      setProposal(out.proposal);
    },
  });

  const confirm = useMutation({
    mutationFn: (p: AssistantProposal) => assistantAct(p.action, p.args),
    onSuccess: (out) => {
      setProposal(null);
      // Recorded as a user turn so the assistant knows on the next question
      // that the change went through, and rendered as a receipt.
      setLines((cur) => [...cur, { role: "user", text: `Done: ${out.result}`, done: true }]);
      // The change touched real data — let every open screen refetch.
      queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (open) boxRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, proposal, ask.isPending]);

  function send() {
    const text = draft.trim();
    if (!text || ask.isPending) return;
    const next: Line[] = [...lines, { role: "user", text }];
    setLines(next);
    setDraft("");
    setProposal(null);
    ask.mutate(next);
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
        <strong>Assistant</strong>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn neutral sm"
            onClick={() => { setLines([]); setProposal(null); ask.reset(); }}
            disabled={lines.length === 0}
          >
            Clear
          </button>
          <button className="btn neutral sm" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>

      <div className="assistant-log" ref={scrollRef}>
        {lines.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{GREETING}</p>}

        {lines.map((l, i) => (
          <div
            key={i}
            className={`assistant-msg ${l.done ? "receipt" : l.role}`}
          >
            {l.done ? (
              `✓ ${l.text.replace(/^Done: /, "")}`
            ) : l.role === "assistant" ? (
              // Only the assistant's side is markdown. What the person typed is
              // shown verbatim — their asterisks are asterisks.
              <Markdown text={l.text} />
            ) : (
              l.text
            )}
          </div>
        ))}

        {ask.isPending && <div className="assistant-msg assistant muted">Thinking…</div>}

        {ask.isError && (
          <div className="assistant-msg assistant tone-low">
            Couldn't reach the assistant. Check the connection and try again.
          </div>
        )}

        {proposal && (
          <div className="assistant-proposal">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Confirm this change</div>
            <div style={{ marginBottom: 10 }}>{proposal.summary}</div>
            {confirm.isError && (
              <p className="tone-low" style={{ fontSize: 13 }}>
                That didn't go through. Nothing was changed.
              </p>
            )}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button
                className="btn neutral sm"
                disabled={confirm.isPending}
                onClick={() => setProposal(null)}
              >
                Cancel
              </button>
              <button
                className="btn primary sm"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate(proposal)}
              >
                {confirm.isPending ? "Doing it…" : "Confirm"}
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
    </div>
  );
}
