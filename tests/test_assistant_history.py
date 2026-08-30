"""Saved conversations: persistence, privacy between employees, and New chat."""

from tests.test_assistant import (  # noqa: F401  (fake_model is a fixture)
    _Response,
    _Text,
    fake_model,
)


def _say(c, text, conversation_id=None):
    body = {"message": text}
    if conversation_id is not None:
        body["conversation_id"] = conversation_id
    return c.post("/api/v1/assistant/chat", json=body)


def test_a_first_message_starts_a_conversation_and_titles_it(client, fake_model):
    fake_model(_Response("end_turn", [_Text("Three are due.")]))

    out = _say(client, "How many orders are due tomorrow?").json()
    assert out["conversation_id"] > 0
    assert out["title"] == "How many orders are due tomorrow?"

    listed = client.get("/api/v1/assistant/conversations").json()
    assert [c["id"] for c in listed] == [out["conversation_id"]]


def test_both_sides_of_the_exchange_are_stored(client, fake_model):
    fake_model(_Response("end_turn", [_Text("Three are due.")]))
    cid = _say(client, "how many due?").json()["conversation_id"]

    convo = client.get(f"/api/v1/assistant/conversations/{cid}").json()
    assert [(m["role"], m["text"]) for m in convo["messages"]] == [
        ("user", "how many due?"),
        ("assistant", "Three are due."),
    ]


def test_history_is_sent_to_the_model_on_the_next_turn(client, fake_model):
    """The point of storing it: the model sees the earlier turns."""
    model = fake_model(
        _Response("end_turn", [_Text("Three are due.")]),
        _Response("end_turn", [_Text("Two of them are deliveries.")]),
    )
    cid = _say(client, "how many due?").json()["conversation_id"]
    _say(client, "how many of those are deliveries?", cid)

    sent = [m["content"] for m in model.calls[1]["messages"]]
    assert sent == [
        "how many due?",
        "Three are due.",
        "how many of those are deliveries?",
    ]


def test_omitting_the_id_starts_a_fresh_conversation(client, fake_model):
    """This is what the New chat button does — no carry-over of context."""
    model = fake_model(
        _Response("end_turn", [_Text("first")]),
        _Response("end_turn", [_Text("second")]),
    )
    first = _say(client, "one").json()["conversation_id"]
    second = _say(client, "two").json()["conversation_id"]

    assert first != second
    assert [m["content"] for m in model.calls[1]["messages"]] == ["two"]
    assert len(client.get("/api/v1/assistant/conversations").json()) == 2


def test_a_question_is_kept_even_when_the_model_call_fails(client, monkeypatch):
    """Recorded before calling out, so a provider outage doesn't lose what the
    person typed."""
    class Failing:
        def __init__(self):
            self.beta = self
            self.messages = self

        def create(self, **kwargs):
            raise RuntimeError("provider down")

    from app.services import assistant as assistant_service
    monkeypatch.setattr(assistant_service, "_client", Failing)

    assert _say(client, "did this survive?").status_code == 502

    listed = client.get("/api/v1/assistant/conversations").json()
    assert len(listed) == 1
    convo = client.get(f"/api/v1/assistant/conversations/{listed[0]['id']}").json()
    assert [m["text"] for m in convo["messages"]] == ["did this survive?"]


def test_conversations_are_private_to_the_employee(client, make_user, fake_model):
    fake_model(_Response("end_turn", [_Text("admin only")]))
    cid = _say(client, "something confidential").json()["conversation_id"]

    _, _, other = make_user("Nosy Nate", "manager")
    # Not listed for them...
    assert other.get("/api/v1/assistant/conversations").json() == []
    # ...and not readable, reported as missing rather than forbidden so its
    # existence isn't leaked.
    assert other.get(f"/api/v1/assistant/conversations/{cid}").status_code == 404
    assert other.delete(f"/api/v1/assistant/conversations/{cid}").status_code == 404


def test_a_conversation_can_be_deleted_with_its_messages(client, fake_model):
    fake_model(_Response("end_turn", [_Text("ok")]))
    cid = _say(client, "delete me").json()["conversation_id"]

    assert client.delete(f"/api/v1/assistant/conversations/{cid}").status_code == 204
    assert client.get("/api/v1/assistant/conversations").json() == []
    assert client.get(f"/api/v1/assistant/conversations/{cid}").status_code == 404


def test_continuing_someone_elses_conversation_is_refused(client, make_user, fake_model):
    fake_model(_Response("end_turn", [_Text("mine")]))
    cid = _say(client, "mine").json()["conversation_id"]

    _, _, other = make_user("Nate Two", "manager")
    assert _say(other, "sneaking in", cid).status_code == 404


def test_the_list_is_most_recent_first(client, fake_model):
    fake_model(
        _Response("end_turn", [_Text("a")]),
        _Response("end_turn", [_Text("b")]),
    )
    first = _say(client, "older question").json()["conversation_id"]
    second = _say(client, "newer question").json()["conversation_id"]

    listed = client.get("/api/v1/assistant/conversations").json()
    assert [c["id"] for c in listed] == [second, first]


def test_a_long_first_message_is_truncated_for_the_title(client, fake_model):
    fake_model(_Response("end_turn", [_Text("ok")]))
    out = _say(client, "x" * 200).json()
    assert len(out["title"]) <= 80
    assert out["title"].endswith("...")


def test_history_is_capped(client, fake_model, monkeypatch):
    """A very long conversation sends a bounded window, not everything."""
    from app.services import assistant as assistant_service
    monkeypatch.setattr(assistant_service, "MAX_HISTORY_TURNS", 4)

    model = fake_model(*[_Response("end_turn", [_Text(f"r{i}")]) for i in range(4)])
    cid = _say(client, "q0").json()["conversation_id"]
    for i in range(1, 4):
        _say(client, f"q{i}", cid)

    assert len(model.calls[-1]["messages"]) == 4
