"""Streaming a turn.

The streamed path and the all-at-once path are the same generator, so what
needs pinning here is that streaming does not *change the answer* — the text,
the proposals and the stored history come out identical either way — and that
the progress events staff see actually track what the server is doing.
"""

import json

import pytest
from sqlalchemy import select

from app.models import User
from app.services import assistant as assistant_service
from tests.test_assistant import (  # noqa: F401 - fake_model is a fixture
    FakeModel,
    _Response,
    _Text,
    _ToolUse,
    fake_model,
)
from tests.conftest import order_payload


@pytest.fixture
def admin(db):
    """The seeded admin, as the service layer sees them."""
    return db.scalar(select(User).where(User.name == "admin"))


def _events(db, user, message, *responses, **kw):
    model = FakeModel(*responses)
    return (
        list(
            assistant_service.chat_events(db, user, message, client=model, stream=True, **kw)
        ),
        model,
    )


def _text_of(events):
    return "".join(e["text"] for e in events if e["type"] == "delta")


def test_answer_arrives_in_pieces(db, admin):
    events, _ = _events(
        db,
        admin,
        "hello",
        _Response("end_turn", [_Text("We are open until four today.")]),
    )
    deltas = [e for e in events if e["type"] == "delta"]

    assert len(deltas) > 1, "the reply came in one lump — it did not stream"
    assert _text_of(events) == "We are open until four today."


def test_the_last_event_is_the_whole_answer(db, admin):
    events, _ = _events(
        db,
        admin,
        "hello",
        _Response("end_turn", [_Text("We are open until four today.")]),
    )
    done = events[-1]

    assert done["type"] == "done"
    assert done["reply"] == "We are open until four today."
    assert done["proposals"] == []
    assert done["conversation_id"]
    # Exactly one, or a client would render the answer twice.
    assert sum(1 for e in events if e["type"] == "done") == 1


def test_a_lookup_says_what_it_is_looking_up(db, admin):
    events, _ = _events(
        db,
        admin,
        "what is on for today?",
        _Response("tool_use", [_ToolUse("list_orders", {})]),
        _Response("end_turn", [_Text("Nothing today.")]),
    )
    statuses = [e["text"] for e in events if e["type"] == "status"]

    assert statuses == ["Checking orders…"]
    # And the status lands before the answer it explains, not after.
    assert events.index(next(e for e in events if e["type"] == "status")) < events.index(
        next(e for e in events if e["type"] == "delta")
    )


def test_several_lookups_are_named_in_one_line(db, admin):
    events, _ = _events(
        db,
        admin,
        "how did today go?",
        _Response(
            "tool_use",
            [
                _ToolUse("sales_report", {}, "a"),
                _ToolUse("production_report", {}, "b"),
            ],
        ),
        _Response("end_turn", [_Text("Quiet.")]),
    )
    statuses = [e["text"] for e in events if e["type"] == "status"]

    assert statuses == ["Checking the sales figures and the bake list…"]


def test_streaming_and_not_streaming_give_the_same_answer(db, admin):
    script = lambda: [  # noqa: E731 - two identical scripts, one per run
        _Response("tool_use", [_ToolUse("list_orders", {})]),
        _Response("end_turn", [_Text("Nothing today.")]),
    ]
    streamed, _ = _events(db, admin, "anything on?", *script())
    plain = assistant_service.chat(
        db, admin, "anything on?", client=FakeModel(*script())
    )

    assert _text_of(streamed) == plain["reply"]
    assert streamed[-1]["proposals"] == plain["proposals"]


def test_a_proposal_still_comes_back_at_the_end(client, make_product, db, admin):
    r = client.post("/api/v1/orders", json=order_payload(make_product()["id"], "key-stream-1"))
    order_id = r.json()["id"]

    events, _ = _events(
        db,
        admin,
        "mark it collected",
        _Response(
            "tool_use",
            [_ToolUse("set_order_status", {"order_id": order_id, "status": "ready"})],
        ),
    )
    done = events[-1]

    assert done["type"] == "done"
    assert len(done["proposals"]) == 1
    assert done["proposals"][0]["action"] == "set_order_status"
    # Nothing ran: a proposal is still only a question.
    assert client.get(f"/api/v1/orders/{order_id}").json()["status"] != "ready"


def test_every_event_survives_json(db, admin):
    """Each one is written into an SSE frame, so none may hold a Decimal."""
    events, _ = _events(
        db,
        admin,
        "hello",
        _Response("tool_use", [_ToolUse("list_orders", {})]),
        _Response("end_turn", [_Text("Nothing today.")]),
    )
    for event in events:
        json.dumps(event)


def test_the_endpoint_streams_sse(client, fake_model):
    fake_model(_Response("end_turn", [_Text("We close at four.")]))

    with client.stream(
        "POST", "/api/v1/assistant/chat/stream", json={"message": "when do you close?"}
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        frames = [
            json.loads(line[len("data: ") :])
            for line in r.iter_lines()
            if line.startswith("data: ")
        ]

    assert "".join(f["text"] for f in frames if f["type"] == "delta") == "We close at four."
    assert frames[-1]["type"] == "done"


def test_the_endpoint_needs_a_sign_in(anon_client):
    r = anon_client.post("/api/v1/assistant/chat/stream", json={"message": "hello"})
    assert r.status_code == 401


def test_a_failure_mid_stream_is_reported_in_the_stream(client, fake_model, monkeypatch):
    """The 200 is already sent, so an error can only reach the person as an event."""
    fake_model(_Response("end_turn", [_Text("ignored")]))

    def boom(*a, **kw):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(assistant_service, "chat_events", boom)

    with client.stream(
        "POST", "/api/v1/assistant/chat/stream", json={"message": "hello"}
    ) as r:
        assert r.status_code == 200
        frames = [
            json.loads(line[len("data: ") :])
            for line in r.iter_lines()
            if line.startswith("data: ")
        ]

    assert frames[-1]["type"] == "error"
    assert "model exploded" not in frames[-1]["message"]
