from __future__ import annotations

from unittest.mock import MagicMock, patch

from briefly_api.api.plan_limits import has_pro_access


def _user(email: str, plan: str = "free") -> MagicMock:
    u = MagicMock()
    u.email = email
    u.plan = plan
    return u


def test_pro_bypass_whitelist_allows_free_plan():
    with patch("briefly_api.api.plan_limits.get_settings") as gs:
        gs.return_value.pro_bypass_email_set = frozenset({"sharshal499@gmail.com"})
        assert has_pro_access(_user("sharshal499@gmail.com")) is True


def test_pro_bypass_is_case_insensitive():
    with patch("briefly_api.api.plan_limits.get_settings") as gs:
        gs.return_value.pro_bypass_email_set = frozenset({"sharshal499@gmail.com"})
        assert has_pro_access(_user("Sharshal499@Gmail.com")) is True


def test_non_whitelisted_free_user_denied():
    with patch("briefly_api.api.plan_limits.get_settings") as gs:
        gs.return_value.pro_bypass_email_set = frozenset({"sharshal499@gmail.com"})
        assert has_pro_access(_user("other@example.com")) is False


def test_pro_plan_always_allowed():
    with patch("briefly_api.api.plan_limits.get_settings") as gs:
        gs.return_value.pro_bypass_email_set = frozenset()
        assert has_pro_access(_user("anyone@example.com", plan="pro")) is True


def test_internal_sources_excluded_from_billable_count():
    from briefly_api.services.connectors.types import INTERNAL_SOURCE_TYPES

    assert "brain_dump" in INTERNAL_SOURCE_TYPES
    assert "browser_capture" in INTERNAL_SOURCE_TYPES
    assert "rss" not in INTERNAL_SOURCE_TYPES
