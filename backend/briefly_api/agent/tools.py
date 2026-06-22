"""
briefly_api/agent/tools.py

Typed, MCP-shaped tool registry for the agent runtime.

A tool is an `AgentTool`: a name, a description the planner reads, an input schema
(MCP-style {param: description}), a side_effect ("read" | "write"), and an async
handler `(ToolContext, args) -> ToolResult`. The registry renders a catalog the
planner sees, and the runtime dispatches by name.

We reuse the existing voice-orb handlers via `from_orb_tool` so capabilities
(today_brief, saved, proactive, web_search, draft_email) are defined once.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class ToolContext:
    """Dependencies + per-turn inputs passed into every tool handler."""
    db: Any = None
    user: Any = None
    settings: Any = None
    goal: str = ""
    thread_id: str | None = None
    content_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResult:
    """A tool's output. `summary` is the observation fed back to the planner."""
    summary: str
    citations: list[dict] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    ok: bool = True
    error: str | None = None


ToolFn = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolResult]]


@dataclass(frozen=True)
class AgentTool:
    name: str
    description: str
    handler: ToolFn
    input_schema: dict[str, Any] = field(default_factory=dict)  # {param: description}
    side_effect: str = "read"  # "read" (safe) | "write" (gated behind confirmation)

    def spec(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "side_effect": self.side_effect,
        }


class ToolRegistry:
    def __init__(self, tools: list[AgentTool] | None = None):
        self._tools: dict[str, AgentTool] = {}
        for t in tools or []:
            self.register(t)

    def register(self, tool: AgentTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> AgentTool | None:
        return self._tools.get(name)

    def all(self) -> list[AgentTool]:
        return list(self._tools.values())

    def catalog(self) -> list[dict[str, Any]]:
        return [t.spec() for t in self._tools.values()]

    def render_catalog(self) -> str:
        lines = []
        for t in self._tools.values():
            args = ", ".join(f"{k}: {v}" for k, v in (t.input_schema or {}).items()) or "none"
            lines.append(f"- {t.name} [{t.side_effect}]: {t.description} (args: {args})")
        return "\n".join(lines)


def from_orb_tool(orb_tool: Any) -> AgentTool:
    """Adapt an existing `OrbTool` (services/orb_tools.py) into an AgentTool so the
    runtime reuses its handler. The orb handler signature is
    (db, user, *, transcript, thread_id, content_id, args) -> {"answer", "citations"}."""

    async def _handler(ctx: ToolContext, args: dict[str, Any]) -> ToolResult:
        out = await orb_tool.handler(
            ctx.db,
            ctx.user,
            transcript=ctx.goal,
            thread_id=ctx.thread_id,
            content_id=ctx.content_id,
            args=args,
        )
        return ToolResult(
            summary=str((out or {}).get("answer", "")),
            citations=list((out or {}).get("citations") or []),
            data=dict(out or {}),
        )

    return AgentTool(
        name=orb_tool.name,
        description=orb_tool.description,
        handler=_handler,
        input_schema=dict(orb_tool.args_schema or {}),
        side_effect=orb_tool.side_effect,
    )


def default_registry() -> ToolRegistry:
    """Registry built from the live orb tool handlers (lazy import to avoid a cycle)."""
    from briefly_api.services.orb_tools import DATA_TOOLS

    return ToolRegistry([from_orb_tool(t) for t in DATA_TOOLS])
