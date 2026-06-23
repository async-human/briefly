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


def load_plugin_tools(registry: ToolRegistry) -> None:
    raw = (get_settings().orb_plugin_modules or "").strip()
    if not raw:
        return
    for name in raw.split(","):
        mod_name = name.strip()
        if not mod_name:
            continue
        try:
            mod = importlib.import_module(mod_name)
            register = getattr(mod, "register_tools", None)
            if callable(register):
                register(registry)
                log.info("orb plugin loaded: %s", mod_name)
        except Exception:
            log.exception("failed to load orb plugin %s", mod_name)
