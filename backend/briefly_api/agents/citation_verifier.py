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

    # Render HTML email body
    ctx.html_body = _render_html(ctx)
    ctx.web_body = _render_web(ctx)

    log.info(
        "CitationVerifierAgent: %d items verified, %d warnings",
        len(ctx.digest_items), len(warnings),
    )
    return ctx


def _render_html(ctx: PipelineContext) -> str:
    """Render the digest as an inline-CSS HTML email."""
    user_name = ctx.user.name or "there"
    skipped_note = ctx.__dict__.get("skipped_note", "")

    # Group items by section
    sections: dict[str, list[DigestItemDraft]] = defaultdict(list)
    for item in ctx.digest_items:
        sections[item.section or "Today"].append(item)

    sections_html = ""
    for section_name, items in sections.items():
        items_html = ""
        for item in items:
            dupe_note = ""
            if item.duplicate_count > 1:
                dupe_note = (
                    f'<p style="font-size:12px;color:#888;margin:4px 0 0 0;">'
                    f"Also covered by {item.duplicate_count - 1} other source(s).</p>"
                )
            memory_note = ""
            if item.memory_connections:
                desc = item.memory_connections[0].get("description", "")
                if desc:
                    memory_note = (
                        f'<p style="font-size:12px;color:#7c6ff7;margin:4px 0 0 0;">'
                        f"&#128279; {desc}</p>"
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
              {dupe_note}{memory_note}
            </div>"""

        sections_html += f"""
          <div style="margin-bottom:32px;">
            <h2 style="margin:0 0 20px 0;font-size:13px;font-weight:700;letter-spacing:1.5px;
                        text-transform:uppercase;color:#5b47e0;border-bottom:2px solid #5b47e0;
                        padding-bottom:8px;">{_esc(section_name)}</h2>
            {items_html}
          </div>"""

    skipped_html = ""
    if skipped_note:
        skipped_html = f"""
          <p style="font-size:13px;color:#999;margin-top:32px;padding-top:16px;
                    border-top:1px solid #eee;font-style:italic;">{_esc(skipped_note)}</p>"""

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


def _render_web(ctx: PipelineContext) -> str:
    """Lightweight web version (same structure, no email hacks needed)."""
    return ctx.html_body  # reuse email HTML for now


def _esc(text: str) -> str:
    """Escape HTML special characters."""
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
