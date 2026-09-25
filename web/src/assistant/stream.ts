// Reading the assistant's answer as it's written.
//
// The turn takes 8-10 seconds — the model thinks, runs a lookup or two, then
// writes — and all of that used to happen behind one spinner. Now the same turn
// arrives as events: what it's looking up, then the answer a few words at a
// time, then the proposals at the end.
//
// EventSource can't do this: it's GET-only and can't set an Authorization
// header. So it's a POST read through a stream reader, and the frame splitting
// lives here in a plain function so it can be tested without a network.

import { API_URL, ApiRequestError, authHeader } from "../api/client";
import type { AssistantProposal } from "../api/types";

/** The two events that happen *during* a turn: what it's looking up, and the
 *  answer as it's written. Named separately because that's all a progress
 *  callback ever sees — an error throws and `done` is the return value. */
export type AssistantProgress =
  | { type: "status"; text: string }
  | { type: "delta"; text: string };

export type AssistantEvent =
  | AssistantProgress
  | { type: "error"; message: string }
  | {
      type: "done";
      conversation_id: number;
      title: string;
      reply: string;
      proposals: AssistantProposal[];
    };

/** Split whatever has arrived so far into whole events, keeping the remainder.
 *
 * A chunk off the wire is not a frame: one read can carry three events, or half
 * of one, and a multi-byte character or a long table can land mid-`data:` line.
 * Anything after the last blank line is therefore incomplete by definition and
 * is handed back to be prepended to the next chunk.
 */
export function drainFrames(buffer: string): { events: AssistantEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AssistantEvent[] = [];

  for (const frame of parts) {
    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as AssistantEvent);
    } catch {
      // A frame we can't read is skipped rather than killing the turn: the
      // answer so far is still worth showing.
    }
  }
  return { events, rest };
}

export type StreamedReply = {
  conversation_id: number;
  title: string;
  reply: string;
  proposals: AssistantProposal[];
};

/** Ask, reporting progress, and resolve with the finished turn.
 *
 * `onEvent` fires for every status and delta. The resolved value is the `done`
 * event — the same shape `/chat` returns — because proposals only exist once
 * the turn is over.
 */
export async function streamChat(
  message: string,
  conversationId: number | null,
  onEvent: (event: AssistantProgress) => void,
  signal?: AbortSignal,
): Promise<StreamedReply> {
  const res = await fetch(`${API_URL}/api/v1/assistant/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ message, conversation_id: conversationId }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new ApiRequestError(
      res.status,
      "stream_failed",
      `The assistant didn't answer (${res.status}).`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: StreamedReply | null = null;

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    // `stream: true` so a character split across two chunks isn't mangled.
    buffer += decoder.decode(chunk.value, { stream: true });
    const drained = drainFrames(buffer);
    buffer = drained.rest;

    for (const event of drained.events) {
      if (event.type === "error") {
        throw new ApiRequestError(500, "assistant_failed", event.message);
      }
      if (event.type === "done") {
        const { type, ...rest } = event;
        void type;
        done = rest;
      } else {
        onEvent(event);
      }
    }
  }

  if (!done) {
    // The connection dropped mid-answer — wifi, a sleeping laptop, a redeploy.
    throw new ApiRequestError(500, "assistant_cut_off", "The answer was cut off.");
  }
  return done;
}
