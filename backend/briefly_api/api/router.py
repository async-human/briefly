from __future__ import annotations

from fastapi import APIRouter

from briefly_api.api.routes import admin, ask, auth, billing, capture, dashboard, decisions, discovery, email_drafts, graph, onboarding, orb, orb_ws, privacy, proactive, push, telegram, watched, webhooks

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(admin.router)
api_router.include_router(webhooks.router)
api_router.include_router(auth.router)
api_router.include_router(billing.router)
api_router.include_router(dashboard.router)
api_router.include_router(graph.router)
api_router.include_router(discovery.router)
api_router.include_router(onboarding.router)
api_router.include_router(capture.router)
api_router.include_router(ask.router)
api_router.include_router(orb.router)
api_router.include_router(orb_ws.router)
api_router.include_router(privacy.router)
api_router.include_router(push.router)
api_router.include_router(proactive.router)
api_router.include_router(telegram.router)
api_router.include_router(watched.router)
api_router.include_router(email_drafts.router)
api_router.include_router(decisions.router)
