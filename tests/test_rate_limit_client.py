"""Who a request is counted against.

`request.client.host` is the proxy's address in production, not the caller's —
Fly terminates the connection and forwards from an internal address. Keying on
it put the whole shop and every visitor to the public menu into about two
buckets, so a busy morning on the website could hand 429s to staff mid-order.
"""

from starlette.datastructures import Headers

from app.core.ratelimit import _client_key


class _Req:
    """Just the two things _client_key reads."""

    def __init__(self, headers: dict, peer: str | None = "172.16.21.82"):
        self.headers = Headers(headers)
        self.client = type("C", (), {"host": peer})() if peer else None


def test_flys_client_ip_header_wins():
    req = _Req({"fly-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9"})
    assert _client_key(req) == "203.0.113.7"


def test_forwarded_for_is_the_fallback():
    assert _client_key(_Req({"x-forwarded-for": "203.0.113.7"})) == "203.0.113.7"


def test_forwarded_for_takes_the_original_client_not_a_proxy():
    """First entry is the caller; the rest are hops it passed through."""
    req = _Req({"x-forwarded-for": "203.0.113.7, 198.51.100.9, 172.16.0.1"})
    assert _client_key(req) == "203.0.113.7"


def test_whitespace_around_entries_is_ignored():
    assert _client_key(_Req({"x-forwarded-for": "  203.0.113.7  , 198.51.100.9"})) == "203.0.113.7"


def test_the_peer_address_is_used_when_there_is_no_proxy():
    """Local dev and the test suite, where nothing sits in front."""
    assert _client_key(_Req({}, peer="127.0.0.1")) == "127.0.0.1"


def test_an_empty_forwarded_header_falls_through():
    assert _client_key(_Req({"x-forwarded-for": ""}, peer="127.0.0.1")) == "127.0.0.1"


def test_a_blank_first_entry_falls_through():
    assert _client_key(_Req({"x-forwarded-for": " , 198.51.100.9"}, peer="127.0.0.1")) == "127.0.0.1"


def test_no_client_at_all_is_survivable():
    assert _client_key(_Req({}, peer=None)) == "unknown"


def test_two_callers_behind_one_proxy_get_separate_buckets():
    """The actual bug: same peer address, different people."""
    peer = "172.16.21.82"
    a = _client_key(_Req({"fly-client-ip": "203.0.113.7"}, peer=peer))
    b = _client_key(_Req({"fly-client-ip": "203.0.113.8"}, peer=peer))
    assert a != b
