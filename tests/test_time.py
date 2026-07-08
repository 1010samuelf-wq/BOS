"""Time tracking: clock in/out + weekly hours (spec §2G, §10)."""

from datetime import date, datetime, timezone

from app.services.time_tracking import aggregate_week, week_bounds


def test_week_bounds_is_monday_to_sunday():
    # 2024-01-03 is a Wednesday
    monday, sunday = week_bounds(date(2024, 1, 3))
    assert monday == date(2024, 1, 1)   # Monday
    assert sunday == date(2024, 1, 7)   # Sunday


def test_aggregate_week_sums_by_clockin_day_incl_open_entry():
    def dt(d, h, m=0):
        return datetime(2024, 1, d, h, m, tzinfo=timezone.utc)

    entries = [
        (dt(1, 9), dt(1, 17)),      # Mon 8.0h
        (dt(2, 8), dt(2, 12, 30)),  # Tue 4.5h
        (dt(3, 10), None),          # Wed open → counts to `now`
    ]
    now = dt(3, 12)  # 2h into the open Wed shift
    days, total = aggregate_week(entries, date(2024, 1, 3), now=now)

    by_day = dict(days)
    assert by_day[date(2024, 1, 1)] == 8.0
    assert by_day[date(2024, 1, 2)] == 4.5
    assert by_day[date(2024, 1, 3)] == 2.0
    assert by_day[date(2024, 1, 6)] == 0.0  # untouched day
    assert len(days) == 7
    assert total == 14.5


def test_aggregate_week_ignores_entries_outside_week():
    def dt(d, h):
        return datetime(2024, 1, d, h, tzinfo=timezone.utc)

    entries = [(dt(8, 9), dt(8, 17))]  # next week's Monday
    days, total = aggregate_week(entries, date(2024, 1, 3))
    assert total == 0.0


def test_clock_in_out_flow_and_hours_endpoint(client, make_user):
    _, _, worker = make_user("jack", "cashier")

    # not clocked in yet → clock-out is a 409
    assert worker.post("/api/v1/time/clock-out").status_code == 409

    r = worker.post("/api/v1/time/clock-in")
    assert r.status_code == 200
    assert r.json()["clock_out"] is None

    # double clock-in → 409
    assert worker.post("/api/v1/time/clock-in").status_code == 409

    # hours endpoint shows the open entry
    h = worker.get("/api/v1/time/hours").json()
    assert h["open_entry"] is not None
    assert len(h["days"]) == 7

    r = worker.post("/api/v1/time/clock-out")
    assert r.status_code == 200
    assert r.json()["clock_out"] is not None

    h = worker.get("/api/v1/time/hours").json()
    assert h["open_entry"] is None


def test_hours_visibility_rules(client, make_user):
    jill_id, _, jill = make_user("jill", "cashier")
    _, _, kate = make_user("kate", "cashier")

    # a cashier viewing another's hours → 403
    assert jill.get(
        "/api/v1/time/hours", params={"employee_id": jill_id}
    ).status_code == 200
    assert kate.get(
        "/api/v1/time/hours", params={"employee_id": jill_id}
    ).status_code == 403

    # admin can view anyone's
    assert client.get(
        "/api/v1/time/hours", params={"employee_id": jill_id}
    ).status_code == 200
