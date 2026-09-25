import { describe, expect, it } from "vitest";

import { drainFrames } from "./stream";

/** A chunk off the wire is not a frame. These are the ways the two differ in
 *  practice — the answer arrives in whatever pieces the network felt like. */
describe("splitting the stream into events", () => {
  it("reads one whole frame", () => {
    const { events, rest } = drainFrames('data: {"type":"delta","text":"Hi"}\n\n');
    expect(events).toEqual([{ type: "delta", text: "Hi" }]);
    expect(rest).toBe("");
  });

  it("reads several frames out of one chunk", () => {
    const buffer =
      'data: {"type":"status","text":"Checking orders…"}\n\n' +
      'data: {"type":"delta","text":"Two"}\n\n' +
      'data: {"type":"delta","text":" orders."}\n\n';
    const { events } = drainFrames(buffer);
    expect(events.map((e) => e.type)).toEqual(["status", "delta", "delta"]);
  });

  it("holds back a frame that hasn't finished arriving", () => {
    const { events, rest } = drainFrames('data: {"type":"delta","text":"Hi"}\n\ndata: {"type":"del');
    expect(events).toHaveLength(1);
    expect(rest).toBe('data: {"type":"del');
  });

  it("finishes a frame split across two chunks", () => {
    const first = drainFrames('data: {"type":"delta","te');
    expect(first.events).toEqual([]);

    const second = drainFrames(first.rest + 'xt":"Hello"}\n\n');
    expect(second.events).toEqual([{ type: "delta", text: "Hello" }]);
  });

  it("keeps a lone trailing newline for the next chunk", () => {
    // The frame separator is two newlines; one is just the end of a data line.
    const { events, rest } = drainFrames('data: {"type":"delta","text":"Hi"}\n');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"type":"delta","text":"Hi"}\n');
  });

  it("carries the whole done event, proposals and all", () => {
    const done = {
      type: "done",
      conversation_id: 7,
      title: "Tuesday orders",
      reply: "Two orders.",
      proposals: [{ action: "set_order_date", args: { order_id: 3 }, summary: "Move #3" }],
    };
    const { events } = drainFrames(`data: ${JSON.stringify(done)}\n\n`);
    expect(events[0]).toEqual(done);
  });

  it("skips a frame it can't parse rather than losing the answer", () => {
    const buffer =
      "data: not json at all\n\n" + 'data: {"type":"delta","text":"Still here"}\n\n';
    const { events } = drainFrames(buffer);
    expect(events).toEqual([{ type: "delta", text: "Still here" }]);
  });

  it("ignores comment and event lines a proxy may inject", () => {
    const buffer = ': keep-alive\n\nevent: ping\ndata: {"type":"delta","text":"Hi"}\n\n';
    const { events } = drainFrames(buffer);
    expect(events).toEqual([{ type: "delta", text: "Hi" }]);
  });

  it("survives text containing a blank line", () => {
    // Markdown tables and paragraphs both contain blank lines, and the server
    // JSON-encodes them, so they must not look like a frame boundary.
    const payload = { type: "delta", text: "one\n\ntwo" };
    const { events } = drainFrames(`data: ${JSON.stringify(payload)}\n\n`);
    expect(events).toEqual([payload]);
  });

  it("reassembles an answer in the order it was sent", () => {
    const chunks = [
      'data: {"type":"status","text":"Checking orders…"}\n\ndata: {"typ',
      'e":"delta","text":"You have "}\n\ndata: {"type":"delta","text":"two"}',
      '\n\ndata: {"type":"delta","text":" today."}\n\n',
    ];
    let rest = "";
    let text = "";
    for (const chunk of chunks) {
      const drained = drainFrames(rest + chunk);
      rest = drained.rest;
      for (const e of drained.events) if (e.type === "delta") text += e.text;
    }
    expect(text).toBe("You have two today.");
    expect(rest).toBe("");
  });
});
