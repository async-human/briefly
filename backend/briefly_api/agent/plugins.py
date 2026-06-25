"""
briefly_api/agent/plugins.py

Optional orb tool plugins loaded from ORB_PLUGIN_MODULES config.
Each module must expose register_tools(registry: ToolRegistry).
"""
from __future__ import annotations

import importlib
import logging

from briefly_api.agent.tools import ToolRegistry
from briefly_api.config import get_settings

log = logging.getLogger(__name__)


def _normalize_plugin_modules(raw: str) -> list[str]:
    """Parse comma-separated module names; tolerate empty env placeholders."""
    text = (raw or "").strip().strip('"').strip("'")
    if not text or text in ('""', "''"):
        return []
    out: list[str] = []
    for name in text.split(","):
        mod_name = name.strip().strip('"').strip("'")
        if mod_name and mod_name not in out:
            out.append(mod_name)
    return out


def load_plugin_tools(registry: ToolRegistry) -> None:
    modules = _normalize_plugin_modules(get_settings().orb_plugin_modules)
    if not modules:
        return
    for mod_name in modules:
        try:
            mod = importlib.import_module(mod_name)
            register = getattr(mod, "register_tools", None)
            if callable(register):
                register(registry)
                log.info("orb plugin loaded: %s", mod_name)
            else:
                log.warning("orb plugin %s has no register_tools()", mod_name)
        except Exception:
            log.exception("failed to load orb plugin %s", mod_name)
