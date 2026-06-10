"""
briefly_api/agents/citation_verifier.py

CitationVerifierAgent: ensures every digest item has a valid source URL
and warns about items that are missing citations.

Also renders the final html_body and web_body from digest_items so the
DeliveryAgent just needs to send whatever is in ctx.html_body.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from briefly_api.agents.context import DigestItemDraft, PipelineContext
from briefly_api.services.outcome_metrics import build_outcome_meta

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Verify citations on all digest items.
    Also renders html_body and web_body for delivery.
    """
    warnings: list[str] = []

    for item in ctx.digest_items:
        if not item.source_url:
            warnings.append(f"Item missing source_url: {item.headline[:60]}")
            log.warning("CitationVerifier: no source_url for '%s'", item.headline[:60])

    ctx.verification_warnings = warnings
    ctx.__dict__["outcome"] = build_outcome_meta(ctx)

    # Render HTML email body
    ctx.html_body = _render_html(ctx)
    ctx.web_body = _render_web(ctx)

    log.info(
        "CitationVerifierAgent: %d items verified, %d warnings",
        len(ctx.digest_items), len(warnings),
    )
    return ctx


def _build_skipped_log(ctx: PipelineContext) -> dict:
    """Aggregate counts by drop reason for the reading-log footer."""
    n_dupes = max(0, ctx.total_ingested - ctx.total_after_dedup) if ctx.total_after_dedup else 0
    n_never_show = sum(1 for i in ctx.dropped_items if i.drop_reason == "never_show")
    n_low_relevance = sum(1 for i in ctx.dropped_items if i.drop_reason == "low_relevance")
    n_crowded_out = len(ctx.crowded_out_items)
    n_sources = len({i.source_id for i in ctx.raw_items}) if ctx.raw_items else 0
    never_show_labels = ctx.user.profile.get("never_show", [])[:3]
    return {
        "n_ingested": ctx.total_ingested,
        "n_shown": len(ctx.digest_items),
        "n_sources": n_sources,
        "n_dupes": n_dupes,
        "n_never_show": n_never_show,
        "n_low_relevance": n_low_relevance,
        "n_crowded_out": n_crowded_out,
        "never_show_labels": never_show_labels,
    }


def _render_html(ctx: PipelineContext) -> str:
    """Render the digest as an inline-CSS HTML email."""
    user_name = ctx.user.name or "there"
    outcome = ctx.__dict__.get("outcome") or {}
    top_ids = set(outcome.get("top_priority_content_ids") or [])

    top_items = [i for i in ctx.digest_items if i.content_id in top_ids]
    if not top_items:
        top_items = sorted(
            ctx.digest_items,
            key=lambda d: d.relevance_score,
            reverse=True,
        )[:3]
    rest_items = [i for i in ctx.digest_items if i not in top_items]

    saved = outcome.get("saved_minutes")
    filtered = outcome.get("filtered_count", 0)
    words = outcome.get("words_scanned", 0)
    skipped_note = (outcome.get("skipped_note") or "").strip()
    outcome_banner = ""
    if saved or words:
        detail = skipped_note or (
            f"Briefly read {outcome.get('items_scanned', ctx.total_ingested)} stories "
            f"({words:,} words) and filtered {filtered} you can safely skip."
        )
        outcome_banner = f"""
          <div style="margin:0 0 28px 0;padding:16px 18px;background:#f4f1ff;border-radius:10px;border-left:4px solid #5b47e0;">
            <p style="margin:0;font-size:14px;color:#444;line-height:1.55;">
              <strong style="color:#5b47e0;">~{saved} min saved</strong> — {detail}
            </p>
          </div>"""

    serendipity = list(getattr(ctx, "serendipity_connections", []) or [])
    serendipity_html = ""
    if serendipity:
        blocks = ""
        for conn in serendipity[:3]:
            blocks += (
                f'<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.55;">'
                f'<strong>{_esc(conn.get("title", "Connection"))}:</strong> '
                f'{_esc(conn.get("body", ""))}</p>'
            )
        serendipity_html = f"""
          <div style="margin:0 0 28px 0;padding:16px 18px;background:#faf8f5;border-radius:10px;border-left:4px solid #c9b896;">
            <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#999;letter-spacing:1.5px;text-transform:uppercase;">Connections Briefly noticed</p>
            {blocks}
          </div>"""

    top_html = ""
    if top_items:
        top_html = _render_items_block(top_items, "Your top 3 for today")

    # Group remaining items by section
    sections: dict[str, list[DigestItemDraft]] = defaultdict(list)
    for item in rest_items:
        sections[item.section or "Today"].append(item)

    sections_html = top_html
    for section_name, items in sections.items():
        sections_html += _render_items_block(items, section_name)

    sl = _build_skipped_log(ctx)
    n_skipped = sl["n_ingested"] - sl["n_shown"]
    rows = ""
    if sl["n_dupes"]:
        rows += _skip_row(str(sl["n_dupes"]), "duplicate stories merged into the items above")
    if sl["n_low_relevance"]:
        rows += _skip_row(str(sl["n_low_relevance"]), "didn’t match your interests closely enough")
    if sl["n_never_show"]:
        label_str = (", ".join(_esc(t) for t in sl["never_show_labels"]) + " &amp; others") if sl["never_show_labels"] else "your topics"
        rows += _skip_row(str(sl["n_never_show"]), f"blocked by your never-show filters ({label_str})")
    if sl["n_crowded_out"]:
        rows += _skip_row(str(sl["n_crowded_out"]), "crowded out — already featured enough from that source today")

    skipped_html = f"""
          <div style="margin-top:40px;padding-top:20px;border-top:1px solid #f0ede8;">
            <p style="font-size:10px;font-weight:700;color:#ccc;letter-spacing:1.8px;
                      text-transform:uppercase;margin:0 0 12px 0;">Briefly&rsquo;s reading log</p>
            <p style="font-size:13px;color:#aaa;margin:0 0 14px 0;line-height:1.6;">
              Scanned <strong style="color:#888;">{sl["n_ingested"]}</strong> stories across
              <strong style="color:#888;">{sl["n_sources"]}</strong> sources today &mdash;
              showed you <strong style="color:#888;">{sl["n_shown"]}</strong>.
              {"The other <strong style=’color:#888;’>" + str(n_skipped) + "</strong>:" if n_skipped else ""}
            </p>
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              {rows}
            </table>
          </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_esc(ctx.subject_line)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#5b47e0;padding:24px 32px;">
          <p style="margin:0;font-size:13px;color:#c4baff;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Briefly</p>
          <h1 style="margin:8px 0 0 0;font-size:22px;color:#ffffff;line-height:1.3;">{_esc(ctx.subject_line)}</h1>
          <p style="margin:8px 0 0 0;font-size:14px;color:#c4baff;">{_esc(ctx.preview_text)}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px 0;font-size:15px;color:#555;">Hey {_esc(user_name)},</p>
          {outcome_banner}
          {serendipity_html}
          {sections_html}
          {skipped_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8f8f8;padding:20px 32px;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">
            You're receiving this because you set up Briefly. &nbsp;|&nbsp;
            <a href="#" style="color:#aaa;">Manage preferences</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _render_items_block(items: list[DigestItemDraft], section_name: str) -> str:
    items_html = ""
    for item in items:
        dupe_note = ""
        if item.duplicate_count > 1:
            dupe_note = (
                f'<p style="font-size:12px;color:#888;margin:4px 0 0 0;">'
                f"Also covered by {item.duplicate_count - 1} other source(s).</p>"
            )
        memory_note = ""
        if item.memory_reference:
            memory_note = (
                f'<p style="font-size:12px;color:#7c6ff7;margin:4px 0 0 0;">'
                f"&#128279; {_esc(item.memory_reference)}</p>"
            )
        elif item.memory_connections:
            desc = item.memory_connections[0].get("description", "")
            if desc:
                memory_note = (
                    f'<p style="font-size:12px;color:#7c6ff7;margin:4px 0 0 0;">'
                    f"&#128279; {_esc(desc)}</p>"
                )
        contradiction_note = ""
        if getattr(item, "contradiction_flag", False) and getattr(item, "contradiction_explanation", ""):
            contradiction_note = (
                f'<p style="font-size:12px;color:#b45309;margin:8px 0 0 0;padding:8px 10px;'
                f'background:#fffbeb;border-radius:6px;">'
                f"&#9888; Contradicts what you read recently: {_esc(item.contradiction_explanation)}</p>"
            )
        confidence_note = ""
        if item.confidence_signal:
            confidence_note = (
                f'<p style="font-size:12px;color:#888;margin:6px 0 0 0;">'
                f"&#9670; {_esc(item.confidence_signal)}</p>"
            )
        items_html += f"""
            <div style="margin-bottom:28px;padding-bottom:24px;border-bottom:1px solid #f0f0f0;">
              <h3 style="margin:0 0 8px 0;font-size:17px;line-height:1.4;font-weight:600;color:#1a1a1a;">
                <a href="{item.source_url or '#'}" style="color:#1a1a1a;text-decoration:none;">{_esc(item.headline)}</a>
              </h3>
              <p style="margin:0 0 8px 0;font-size:14px;color:#444;line-height:1.6;">{_esc(item.summary)}</p>
              <p style="margin:0 0 8px 0;font-size:14px;color:#5b47e0;line-height:1.5;font-style:italic;">
                <strong style="font-style:normal;">Why this matters:</strong> {_esc(item.why_it_matters)}
              </p>
              <p style="margin:0;font-size:12px;color:#888;">
                <a href="{item.source_url or '#'}" style="color:#888;">{_esc(item.source_name or '')}</a>
              </p>
              {confidence_note}{contradiction_note}{dupe_note}{memory_note}
            </div>"""

    return f"""
          <div style="margin-bottom:32px;">
            <h2 style="margin:0 0 20px 0;font-size:13px;font-weight:700;letter-spacing:1.5px;
                        text-transform:uppercase;color:#5b47e0;border-bottom:2px solid #5b47e0;
                        padding-bottom:8px;">{_esc(section_name)}</h2>
            {items_html}
          </div>"""


def _render_web(ctx: PipelineContext) -> str:
    """Lightweight web version (same structure, no email hacks needed)."""
    return ctx.html_body  # reuse email HTML for now


def _skip_row(count: str, reason: str) -> str:
    """One bullet row in the reading-log table."""
    return (
        f'<tr>'
        f'<td style="padding:3px 10px 3px 0;font-size:13px;color:#ccc;vertical-align:top;">&bull;</td>'
        f'<td style="padding:3px 0;font-size:13px;color:#aaa;line-height:1.5;">'
        f'<strong style="color:#888;">{_esc(count)}</strong> {reason}'
        f'</td>'
        f'</tr>'
    )


def _esc(text: str) -> str:
    """Escape HTML special characters."""
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
