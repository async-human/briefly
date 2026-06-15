"""
Smoke test: the FastAPI app must build at import time.

This is the cheapest possible guard against an entire class of production
outages — the kind where the app crashes during import (a 204 route declaring
a response body, a bad decorator, a syntax error, a circular import) and every
request 502s because uvicorn never finishes loading the app.

If this test passes, the app object was constructed and every route registered
cleanly. If it fails, you have an import-time crash that would have taken the
whole API down on deploy.
"""
from __future__ import annotations


def test_app_builds_at_import() -> None:
    # Importing the app runs create_app(), which includes every router and
    # therefore validates every route decorator. A malformed route raises here.
    from briefly_api.main import app

    assert app is not None
    assert len(app.routes) > 0


def test_critical_routes_registered() -> None:
    from briefly_api.main import app

    paths = {getattr(route, "path", "") for route in app.routes}

    # Health check must exist for Railway/Cloudflare to see the origin as up.
    assert "/health" in paths

    # The Google sign-in entrypoint must be registered — it's the first thing
    # a new user hits, and the route that was 502ing when the app failed to boot.
    assert any(p.startswith("/api/v1/auth/google") for p in paths), (
        f"Google auth route missing — registered API paths: "
        f"{sorted(p for p in paths if p.startswith('/api/v1/auth'))}"
    )
