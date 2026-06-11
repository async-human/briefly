from __future__ import annotations

from fastapi import APIRouter

from briefly_api.api.routes import ask, auth, billing, capture, dashboard, discovery, graph, onboarding, privacy, webhooks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(webhooks.router)
api_router.include_router(auth.router)
api_router.include_router(billing.router)
api_router.include_router(dashboard.router)
api_router.include_router(graph.router)
api_router.include_router(discovery.router)
api_router.include_router(onboarding.router)
api_router.include_router(capture.router)
api_router.include_router(ask.router)
api_router.include_router(privacy.router)
