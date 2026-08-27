"""Staff feedback (app/api/v1/feedback.py).

The access rule is the interesting part: *anyone* signed in may submit from any
screen, but only an admin may read the pile.
"""


def _submit(c, message="The order list loads slowly on the tablet", **over):
    body = {"message": message, "source": "web", "context": "/orders"}
    body.update(over)
    return c.post("/api/v1/feedback", json=body)


def test_submit_returns_the_stored_note(client):
    r = _submit(client)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["message"] == "The order list loads slowly on the tablet"
    assert out["source"] == "web"
    assert out["context"] == "/orders"
    assert out["handled"] is False
    assert out["created_at"].endswith("+00:00")  # explicit UTC, never naive


def test_any_role_may_submit_even_without_sections(make_user):
    """A cashier has no admin sections at all — they must still be able to
    report a problem, or the feature is useless to the people who hit them."""
    _, _, cashier = make_user("Cashier Cass", "cashier")
    assert _submit(cashier, "Card reader screen is confusing", source="tablet").status_code == 201


def test_submitter_name_is_attached(client, make_user):
    _, _, manager = make_user("Manager Mo", "manager")
    _submit(manager, "Please add a bigger font")

    rows = client.get("/api/v1/feedback").json()
    assert rows[0]["user_name"] == "Manager Mo"


def test_non_admin_cannot_read_feedback(make_user):
    _, _, manager = make_user("Nosy Nate", "manager")
    _submit(manager, "something")
    assert manager.get("/api/v1/feedback").status_code == 403


def test_anonymous_cannot_submit_or_read(anon_client):
    assert _submit(anon_client).status_code == 401
    assert anon_client.get("/api/v1/feedback").status_code == 401


def test_newest_first_and_handled_filter(client):
    _submit(client, "first")
    second = _submit(client, "second").json()

    rows = client.get("/api/v1/feedback").json()
    assert [r["message"] for r in rows] == ["second", "first"]

    done = client.post(f"/api/v1/feedback/{second['id']}/handled", json={"handled": True})
    assert done.status_code == 200
    assert done.json()["handled"] is True
    assert done.json()["handled_at"] is not None

    assert [r["message"] for r in client.get("/api/v1/feedback?handled=false").json()] == ["first"]
    assert [r["message"] for r in client.get("/api/v1/feedback?handled=true").json()] == ["second"]


def test_handled_can_be_undone(client):
    fid = _submit(client, "reopen me").json()["id"]
    client.post(f"/api/v1/feedback/{fid}/handled", json={"handled": True})

    out = client.post(f"/api/v1/feedback/{fid}/handled", json={"handled": False}).json()
    assert out["handled"] is False
    assert out["handled_at"] is None and out["handled_by"] is None


def test_marking_unknown_feedback_is_404(client):
    assert client.post("/api/v1/feedback/9999/handled", json={"handled": True}).status_code == 404


def test_empty_message_is_rejected(client):
    assert _submit(client, "").status_code == 400
    assert _submit(client, "x" * 2001).status_code == 400


def test_source_must_be_a_known_client(client):
    assert _submit(client, "hi", source="carrier-pigeon").status_code == 400
