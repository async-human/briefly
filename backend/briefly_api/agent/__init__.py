"""
briefly_api/agent — the agent runtime (Phase 0, Slice 2).

A provider-agnostic plan→execute→observe loop over a typed, MCP-shaped tool
registry. This is the spine the act layer (Phase 1 workflows) runs on. It does NOT
yet replace the live orb routing — that swap happens once the runtime beats the
heuristic router on the eval baseline (see briefly_api/eval).
"""
from briefly_api.agent.runtime import AgentResult, AgentRuntime, AgentStep
from briefly_api.agent.tools import (
    AgentTool,
    ToolContext,
    ToolRegistry,
    ToolResult,
    default_registry,
    from_orb_tool,
)

__all__ = [
    "AgentResult",
    "AgentRuntime",
    "AgentStep",
    "AgentTool",
    "ToolContext",
    "ToolRegistry",
    "ToolResult",
    "default_registry",
    "from_orb_tool",
]
