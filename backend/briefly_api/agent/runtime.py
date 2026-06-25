"""
briefly_api/agent/runtime.py

The agent runtime: a provider-agnostic plan→execute→observe loop.

Each step the planner sees the goal, the tool catalog, and the running history,
then returns STRICT JSON choosing either a tool to run or a final answer. Tools
execute, their observation is appended, and the loop repeats up to a step budget.

Reliability features (this is an agent product — reliability is the whole game):
  - step budget (caps cost + runaway loops)
  - write-gating: "write" tools don't execute unless allow_writes=True (HITL)
  - error recovery: a handler crash becomes an observation, so the agent can adapt
  - full trace: every step is recorded for the audit log (Slice 3 persists it)

The LLM is injected so the loop is unit-testable offline with a scripted planner.
"""
from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from briefly_api.agent.tools import ToolContext, ToolRegistry, ToolResult

log = logging.getLogger(__name__)

_PLANNER_SYSTEM = (
    "You are Briefly's voice assistant — a thoughtful human colleague, not a silent executor. "
    "Accomplish the user's goal using available tools, grounded in the user's OWN data. "
    "Before running a tool, check whether critical details are missing (recipient, topic, date, "
    "scope, location). If anything essential is unclear, do NOT guess — ask ONE short clarifying "
    "question instead (tool=\"\", final=your question). "
    "When the user asks to create or write a report, use compose_report — it already "
    "searches the web and the user's library. Do NOT call web_search before compose_report "
    "for report requests, and do NOT call compose_report more than once. "
    "When compose_report succeeds, stop and give the user the spoken report summary. "
    "When the user explicitly asked for web/internet search, use web_search first — "
    "do not ask whether to use internal sources versus the web. "
    "When you have enough context, proceed step by step. Prefer the user's own sources "
    "only when they did NOT ask for the web. Spoken answers should sound warm and natural. "
    "Respond in STRICT JSON only."
)

_PLANNER_INSTRUCTIONS = (
    'Return JSON: {"thought": string, "tool": string, "args": object, "final": string}. '
    'Set "tool" to one of the tool names to run it (with "args"), and leave "final" empty. '
    'When done, set "tool" to "" and put the answer to the user in "final". '
    'If the request is ambiguous or required information is missing, set "tool" to "" and put '
    'ONE short clarifying question in "final" — do not invent missing details. '
    "If a tool's observation is a clarifying question or shows missing information, STOP and "
    'return that question as "final" (do not guess). '
    'If an observation starts with "REPORT_COMPLETE" or says the report is finished, set '
    '"tool" to "" and summarize for the user in "final".'
)

_MAX_OBS_CHARS = 600
_REPORT_OBS_CHARS = 1200
_REPORT_DONE_RE = re.compile(r"\b(?:finished your report|report is ready|REPORT_COMPLETE)\b", re.I)


@dataclass
class _PlanMessage:
    """Duck-typed message (role/content) — the LLM adapter only reads these two
    fields, so we avoid importing the DB-bound adapter module just to build a
    message. Keeps the runtime unit-testable offline with an injected stub LLM."""
    role: str
    content: str


@dataclass
class AgentStep:
    n: int
    thought: str
    tool: str | None
    args: dict[str, Any]
    observation: str
    ok: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "n": self.n,
            "thought": self.thought,
            "tool": self.tool,
            "args": self.args,
            "observation": self.observation,
            "ok": self.ok,
        }


@dataclass
class AgentResult:
    answer: str
    steps: list[AgentStep] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    stopped_reason: str = "final"  # "final" | "max_steps" | "needs_confirmation" | "error"
    thread_id: str | None = None   # carried from tools (e.g. ask_briefly) for conversation continuity

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "stopped_reason": self.stopped_reason,
            "tools_used": self.tools_used,
            "citations": self.citations,
            "thread_id": self.thread_id,
            "steps": [s.to_dict() for s in self.steps],
        }


class AgentRuntime:
    def __init__(
        self,
        registry: ToolRegistry,
        *,
        llm: Any = None,
        max_steps: int = 4,
        allow_writes: bool = False,
    ):
        self.registry = registry
        self._llm = llm
        self.max_steps = max(1, max_steps)
        self.allow_writes = allow_writes

    def _llm_adapter(self):
        if self._llm is not None:
            return self._llm
        from briefly_api.llm.adapter import get_llm_adapter

        self._llm = get_llm_adapter()
        return self._llm

    async def _plan(self, ctx: ToolContext, history: list[str]) -> dict[str, Any]:
        hist = "\n".join(history) if history else "(none yet)"
        user = (
            f"GOAL: {ctx.goal}\n\n"
            f"TOOLS:\n{self.registry.render_catalog()}\n\n"
            f"HISTORY:\n{hist}\n\n"
            f"{_PLANNER_INSTRUCTIONS}"
        )
        llm = self._llm_adapter()
        try:
            data = await llm.complete_json(
                [_PlanMessage(role="user", content=user)],
                system=_PLANNER_SYSTEM,
                user_id=getattr(ctx.user, "id", None),
                agent="agent_planner",
            )
        except Exception as exc:
            log.warning("agent planner JSON failed: %r", exc)
            return {"thought": "", "tool": "", "args": {}, "final": ""}
        return data if isinstance(data, dict) else {}

    async def iter_run(self, ctx: ToolContext) -> AsyncIterator[dict[str, Any]]:
        """Stream planner steps; final event is ``agent_result`` with ``AgentResult``."""
        steps: list[AgentStep] = []
        citations: list[dict] = []
        tools_used: list[str] = []
        history: list[str] = list((ctx.extra or {}).get("agent_history") or [])
        resolved_thread_id = ctx.thread_id

        for n in range(1, self.max_steps + 1):
            plan = await self._plan(ctx, history)
            thought = str(plan.get("thought") or "")
            final = str(plan.get("final") or "").strip()
            tool_name = str(plan.get("tool") or "").strip()
            args = plan.get("args") if isinstance(plan.get("args"), dict) else {}

            if not tool_name:
                answer = final or self._fallback_answer(history)
                result = AgentResult(
                    answer, steps, citations, tools_used, "final", thread_id=resolved_thread_id
                )
                yield {"type": "agent_result", "result": result}
                return

            yield {
                "type": "agent_step",
                "n": n,
                "tool": tool_name,
                "phase": "start",
                "thought": thought[:240],
            }

            tool = self.registry.get(tool_name)
            if tool is None:
                obs = (
                    f"No such tool '{tool_name}'. Available: "
                    f"{', '.join(t.name for t in self.registry.all())}."
                )
                steps.append(AgentStep(n, thought, tool_name, args, obs, ok=False))
                history.append(f"step{n}: tried {tool_name} -> {obs}")
                yield {
                    "type": "agent_step",
                    "n": n,
                    "tool": tool_name,
                    "phase": "done",
                    "ok": False,
                    "observation": obs[:180],
                }
                continue

            if tool.side_effect == "write" and not self.allow_writes:
                msg = (
                    f"The step '{tool_name}' makes a change and needs your confirmation. "
                    "Approve it and I'll proceed."
                )
                steps.append(
                    AgentStep(n, thought, tool_name, args, "blocked: needs confirmation", ok=False)
                )
                result = AgentResult(
                    msg, steps, citations, tools_used, "needs_confirmation", thread_id=resolved_thread_id
                )
                yield {
                    "type": "agent_step",
                    "n": n,
                    "tool": tool_name,
                    "phase": "done",
                    "ok": False,
                    "observation": "blocked: needs confirmation",
                }
                yield {"type": "agent_result", "result": result}
                return

            if tool_name == "compose_report" and "compose_report" in tools_used:
                prior = next(
                    (s for s in reversed(steps) if s.tool == "compose_report" and s.ok),
                    None,
                )
                if prior:
                    answer = prior.observation or self._fallback_answer(history)
                    result = AgentResult(
                        answer, steps, citations, tools_used, "final", thread_id=resolved_thread_id
                    )
                    yield {"type": "agent_result", "result": result}
                    return

            try:
                result = await tool.handler(ctx, args)
            except Exception as exc:
                log.warning("agent tool '%s' failed", tool_name)
                result = ToolResult(summary=f"Tool error: {exc!r}", ok=False, error=repr(exc))

            tools_used.append(tool_name)
            tid = (result.data or {}).get("thread_id")
            if tid:
                resolved_thread_id = tid
            if result.citations:
                citations.extend(result.citations)
            obs_limit = _REPORT_OBS_CHARS if tool_name == "compose_report" else _MAX_OBS_CHARS
            raw_summary = str(result.summary or "")
            obs = raw_summary[:obs_limit]
            if tool_name == "compose_report" and result.ok:
                obs = f"REPORT_COMPLETE: {obs}"
            steps.append(AgentStep(n, thought, tool_name, args, obs, ok=result.ok))
            history.append(f"step{n}: {tool_name}({json.dumps(args, default=str)}) -> {obs}")
            yield {
                "type": "agent_step",
                "n": n,
                "tool": tool_name,
                "phase": "done",
                "ok": result.ok,
                "observation": obs[:180],
            }

            if tool_name == "compose_report" and result.ok and _REPORT_DONE_RE.search(raw_summary):
                answer = raw_summary or self._fallback_answer(history)
                result = AgentResult(
                    answer, steps, citations, tools_used, "final", thread_id=resolved_thread_id
                )
                yield {"type": "agent_result", "result": result}
                return

        result = AgentResult(
            self._fallback_answer(history),
            steps,
            citations,
            tools_used,
            "max_steps",
            thread_id=resolved_thread_id,
        )
        yield {"type": "agent_result", "result": result}

    async def run(self, ctx: ToolContext) -> AgentResult:
        result: AgentResult | None = None
        async for event in self.iter_run(ctx):
            if event.get("type") == "agent_result":
                result = event["result"]
        if result is not None:
            return result
        return AgentResult(
            self._fallback_answer([]),
            [],
            [],
            [],
            "error",
            thread_id=ctx.thread_id,
        )

    @staticmethod
    def _fallback_answer(history: list[str]) -> str:
        if not history:
            return "I couldn't complete that — try rephrasing the goal."
        # Last observation is usually the most relevant payload.
        last = history[-1]
        return last.split(" -> ", 1)[-1] if " -> " in last else last
