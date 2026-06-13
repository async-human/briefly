"""Tests for Dodo Payments helpers."""
from briefly_api.services.dodo_payments import (
    extract_billing_identity,
    is_downgrade_event,
    is_upgrade_event,
)


def test_upgrade_events():
    assert is_upgrade_event("subscription.active")
    assert is_downgrade_event("subscription.cancelled")


def test_extract_billing_identity_from_metadata():
    event = {
        "type": "subscription.active",
        "data": {
            "metadata": {"briefly_user_id": "user-123"},
            "customer": {"email": "test@example.com", "customer_id": "cus_1"},
            "subscription_id": "sub_1",
        },
    }
    user_id, email, customer_id, subscription_id = extract_billing_identity(event)
    assert user_id == "user-123"
    assert email == "test@example.com"
    assert customer_id == "cus_1"
    assert subscription_id == "sub_1"
