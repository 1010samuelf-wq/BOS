"""Tasks: create, assignment visibility, done toggle, overdue flag (§2J/§10)."""

from datetime import datetime, timedelta, timezone


def _emp_id(client, name):
    return next(e["id"] for e in client.get(
        "/api/v1/employees", params={"include_inactive": True}).json() if e["name"] == name)


def test_manager_creates_task_and_overdue_flag(client, make_user):
    _, _, _ = make_user("rita", "cashier")
    uid = _emp_id(client, "rita")

    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    r = client.post("/api/v1/tasks", json={
        "description": "Restock flour", "assigned_to": uid, "due_date": past})
    assert r.status_code == 201
    assert r.json()["is_overdue"] is True
    assert r.json()["done"] is False


def test_cashier_cannot_create_task(client, make_user):
    _, _, cashier = make_user("sam", "cashier")
    r = cashier.post("/api/v1/tasks", json={"description": "x", "assigned_to": 1})
    assert r.status_code == 403


def test_employee_sees_only_own_tasks(client, make_user):
    _, _, tara = make_user("tara", "cashier")
    _, _, uma = make_user("uma", "cashier")
    tara_id = _emp_id(client, "tara")
    uma_id = _emp_id(client, "uma")

    client.post("/api/v1/tasks", json={"description": "A", "assigned_to": tara_id})
    client.post("/api/v1/tasks", json={"description": "B", "assigned_to": uma_id})

    # tara sees only her task
    mine = tara.get("/api/v1/tasks").json()
    assert len(mine) == 1 and mine[0]["assigned_to"] == tara_id

    # tara cannot query uma's tasks
    assert tara.get("/api/v1/tasks", params={"employee_id": uma_id}).status_code == 403

    # admin sees all
    assert len(client.get("/api/v1/tasks").json()) == 2


def test_assignee_can_toggle_done(client, make_user):
    _, _, vic = make_user("vic", "cashier")
    vic_id = _emp_id(client, "vic")
    tid = client.post("/api/v1/tasks", json={
        "description": "Sweep", "assigned_to": vic_id}).json()["id"]

    # mark done
    r = vic.post(f"/api/v1/tasks/{tid}/done")
    assert r.status_code == 200
    assert r.json()["done"] is True
    assert r.json()["done_by"] == vic_id

    # toggle back off
    r = vic.post(f"/api/v1/tasks/{tid}/done")
    assert r.json()["done"] is False
    assert r.json()["done_by"] is None


def test_other_cashier_cannot_complete_task(client, make_user):
    _, _, will = make_user("will", "cashier")
    _, _, xena = make_user("xena", "cashier")
    will_id = _emp_id(client, "will")
    tid = client.post("/api/v1/tasks", json={
        "description": "Mop", "assigned_to": will_id}).json()["id"]

    # xena (not the assignee, not a manager) is blocked
    assert xena.post(f"/api/v1/tasks/{tid}/done").status_code == 403
    # admin can complete anyone's
    assert client.post(f"/api/v1/tasks/{tid}/done").status_code == 200


def test_done_task_not_overdue(client, make_user):
    _, _, _ = make_user("yara", "cashier")
    yid = _emp_id(client, "yara")
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    tid = client.post("/api/v1/tasks", json={
        "description": "Old task", "assigned_to": yid, "due_date": past}).json()["id"]

    done = client.post(f"/api/v1/tasks/{tid}/done", json={"done": True}).json()
    assert done["done"] is True
    assert done["is_overdue"] is False  # done → never overdue
