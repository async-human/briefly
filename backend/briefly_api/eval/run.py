"""
briefly_api/eval/run.py

Run Briefly's eval suites and print a baseline report. This is the reliability
backbone — run it before/after any change to the agent or act layers, and in CI.

Usage:
  python -m briefly_api.eval.run                 # run all registered suites
  python -m briefly_api.eval.run grounded_email  # run one suite by name

Exit code is non-zero if any suite falls below its min pass-rate gate, so CI can
fail the build on a regression. LLM-as-judge scorers require a configured model
(LLM_PROVIDER + API key); deterministic scorers always run.
"""
from __future__ import annotations

import asyncio
import json
import sys

from briefly_api.eval.harness import run_suite
from briefly_api.eval.suites import grounded_email

# Register suites here as we add workflows (research_report, composite, …).
_SUITES = {
    grounded_email.SUITE: grounded_email.build,
}


async def _run(selected: list[str]) -> int:
    names = selected or list(_SUITES)
    overall_ok = True
    summaries = []
    for name in names:
        builder = _SUITES.get(name)
        if not builder:
            print(f"unknown suite: {name} (have: {', '.join(_SUITES)})", file=sys.stderr)
            overall_ok = False
            continue
        suite, cases, runner, scorers, min_pass = builder()
        report = await run_suite(suite, cases, runner, scorers)
        summary = report.summary()
        summary["gate"] = {"min_pass_rate": min_pass, "passed": report.gate(min_pass)}
        summaries.append(summary)
        overall_ok = overall_ok and report.gate(min_pass)

    print(json.dumps({"suites": summaries, "ok": overall_ok}, indent=2))
    return 0 if overall_ok else 1


def main() -> None:
    selected = [a for a in sys.argv[1:] if not a.startswith("-")]
    raise SystemExit(asyncio.run(_run(selected)))


if __name__ == "__main__":
    main()
