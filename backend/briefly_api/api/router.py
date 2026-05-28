from __future__ import annotations

from fastapi import APIRouter

from briefly_api.api.routes import auth, dashboard, onboarding

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(onboarding.router)
