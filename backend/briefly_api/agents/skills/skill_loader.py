"""
briefly_api/agents/skills/skill_loader.py

Three-level skill loading:

  Level 1  name + description (frontmatter) — always available, used for
           triggering decisions. ~100 words, zero LLM cost.

  Level 2  full SKILL.md body — loaded when the skill is invoked and becomes
           the system prompt for that LLM call.

  Level 3  reference files in references/ — loaded on demand when the skill
           needs a specific sub-capability (e.g. the narrative skill loading
           memory_callout_rules.md only when there are active story threads).

This means:
  - Reasoning rules live in .md files, not Python strings
  - Improving a skill = editing SKILL.md, not touching Python
  - Reference files are only loaded when the skill needs them, keeping the
    total token count for each LLM call as small as possible

Usage:
    from briefly_api.agents.skills.skill_loader import SkillLoader

    # Load system prompt (Level 2)
    loader = SkillLoader("narrative")
    system_prompt = loader.body

    # Load a reference document on demand (Level 3)
    voice_rules = loader.reference("voice_and_style.md")
    system_with_ref = system_prompt + "\n\n" + voice_rules
"""
from __future__ import annotations

import pathlib
from functools import lru_cache

_SKILLS_DIR = pathlib.Path(__file__).parent


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """
    Parse YAML-style frontmatter from a markdown file.
    Returns (frontmatter_dict, body_string).
    Handles: string values, quoted strings, inline lists [a, b, c].
    Does not require PyYAML — keeps the backend dependency list clean.
    """
    if not text.startswith("---"):
        return {}, text

    try:
        end = text.index("---", 3)
    except ValueError:
        return {}, text

    fm_raw  = text[3:end].strip()
    body    = text[end + 3:].strip()
    result: dict = {}
    cur_key:  str | None   = None
    cur_list: list | None  = None

    for raw_line in fm_raw.splitlines():
        line = raw_line.rstrip()
        if not line or line.startswith("#"):
            continue

        # List item continuation
        if (line.startswith("  - ") or line.startswith("- ")) and cur_key:
            val = line.lstrip("- ").strip().strip("'\"")
            if cur_list is None:
                cur_list = []
                result[cur_key] = cur_list
            cur_list.append(val)
            continue

        # New key
        if ":" in line:
            cur_list = None
            key, _, raw_val = line.partition(":")
            key     = key.strip()
            raw_val = raw_val.strip()
            cur_key = key

            if not raw_val:
                result[key] = None          # value follows as list
            elif raw_val.startswith("[") and raw_val.endswith("]"):
                result[key] = [
                    v.strip().strip("'\"")
                    for v in raw_val[1:-1].split(",")
                    if v.strip()
                ]
            else:
                result[key] = raw_val.strip("'\"")

    return result, body


class SkillLoader:
    """
    Loads and caches a single skill's SKILL.md and reference files.

    Args:
        skill_name: folder name inside agents/skills/ (e.g. "narrative")
    """

    def __init__(self, skill_name: str) -> None:
        self._skill_name = skill_name
        self._skill_dir  = _SKILLS_DIR / skill_name
        self._skill_path = self._skill_dir / "SKILL.md"

        if not self._skill_path.exists():
            raise FileNotFoundError(
                f"SKILL.md not found for skill '{skill_name}' at {self._skill_path}"
            )

        raw = self._skill_path.read_text(encoding="utf-8")
        self._frontmatter, self._body = _parse_frontmatter(raw)

    # ── Level 1 (always available) ────────────────────────────────────────────

    @property
    def name(self) -> str:
        return self._frontmatter.get("name") or self._skill_name

    @property
    def description(self) -> str:
        return self._frontmatter.get("description") or ""

    @property
    def model(self) -> str | None:
        """Default model override declared in frontmatter, if any."""
        return self._frontmatter.get("model")

    @property
    def max_tokens(self) -> int | None:
        val = self._frontmatter.get("max_tokens")
        return int(val) if val else None

    # ── Level 2 (loaded when skill triggers) ─────────────────────────────────

    @property
    def body(self) -> str:
        """Full SKILL.md body — use as the LLM system prompt."""
        return self._body

    # ── Level 3 (loaded on demand) ────────────────────────────────────────────

    def reference(self, filename: str) -> str:
        """
        Load a reference document from this skill's references/ directory.
        Raises FileNotFoundError if the file does not exist.
        """
        ref_path = self._skill_dir / "references" / filename
        if not ref_path.exists():
            raise FileNotFoundError(
                f"Reference '{filename}' not found for skill '{self._skill_name}'"
            )
        return ref_path.read_text(encoding="utf-8")

    def reference_or_empty(self, filename: str) -> str:
        """Load a reference document; return empty string if not found."""
        try:
            return self.reference(filename)
        except FileNotFoundError:
            return ""

    def has_reference(self, filename: str) -> bool:
        return (self._skill_dir / "references" / filename).exists()

    def list_references(self) -> list[str]:
        ref_dir = self._skill_dir / "references"
        if not ref_dir.exists():
            return []
        return sorted(p.name for p in ref_dir.iterdir() if p.is_file())


@lru_cache(maxsize=32)
def get_skill(skill_name: str) -> SkillLoader:
    """
    Module-level cached skill loader.
    Use this in skill classes so each SKILL.md is only read once per process.
    """
    return SkillLoader(skill_name)
