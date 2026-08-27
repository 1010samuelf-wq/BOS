// A "Feedback" button pinned to the corner of every signed-in page, and the
// popup behind it. Deliberately available everywhere rather than living on its
// own page: the moment someone wants to report a problem is while they are
// looking at it, and the current route is captured automatically so the report
// arrives with the screen already attached.

import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { submitFeedback } from "../api/endpoints";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const location = useLocation();
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useMutation({
    mutationFn: () =>
      submitFeedback({ message: message.trim(), source: "web", context: location.pathname }),
    onSuccess: () => {
      setSent(true);
      setMessage("");
    },
  });

  // Focus the box on open so it's usable straight from the keyboard.
  useEffect(() => {
    if (open) boxRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setSent(false);
    mutation.reset();
  }

  if (!open) {
    return (
      <button className="feedback-fab" onClick={() => setOpen(true)} title="Send feedback">
        💬 Feedback
      </button>
    );
  }

  return (
    <div className="feedback-backdrop" onClick={close}>
      {/* stopPropagation: clicking inside the card must not count as clicking
          the backdrop, or the popup closes on every keystroke-adjacent click. */}
      <div className="feedback-card" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <>
            <h3>Thanks — that's been sent.</h3>
            <p className="muted">It's saved for the team to read.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn primary" onClick={close}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h3>Send feedback</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              A problem, something confusing, or an idea. You're on <code>{location.pathname}</code>.
            </p>
            <textarea
              ref={boxRef}
              className="input"
              rows={5}
              maxLength={2000}
              placeholder="What's happening?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && message.trim()) mutation.mutate();
              }}
            />
            {mutation.isError && (
              <p className="tone-low" style={{ fontSize: 13 }}>
                Couldn't send that — check the connection and try again.
              </p>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn neutral" onClick={close}>Cancel</button>
              <button
                className="btn primary"
                disabled={!message.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
