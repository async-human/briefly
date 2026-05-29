"""
briefly_api/services/email_renderer.py

Renders digest items into a clean HTML email body.
Uses inline CSS only — required for broad email client compatibility.
"""
from __future__ import annotations


def render_digest_html(
    user_name: str | None,
    digest_date: str,
    items: list[dict],
    subject_line: str,
    web_url: str = "",
) -> str:
    greeting = user_name.split()[0] if user_name else "there"

    # Render each item
    items_html = ""
    for i, item in enumerate(items):
        section = item.get("section") or ""
        headline = item.get("headline", "")
        summary = item.get("summary", "")
        why = item.get("why_it_matters", "")
        source_name = item.get("source_name") or ""
        source_url = item.get("source_url") or ""

        section_html = (
            f'<p style="margin:0 0 6px;font-size:10px;color:#8a8a8a;'
            f'text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">'
            f"{section}</p>"
        ) if section else ""

        source_html = ""
        if source_name and source_url:
            source_html = (
                f'<p style="margin:0 0 8px;font-size:12px;color:#8a8a8a">'
                f'<a href="{source_url}" style="color:#8a8a8a;text-decoration:none">'
                f"{source_name}</a></p>"
            )
        elif source_name:
            source_html = (
                f'<p style="margin:0 0 8px;font-size:12px;color:#8a8a8a">{source_name}</p>'
            )

        read_link = ""
        if source_url:
            read_link = (
                f'<p style="margin:12px 0 0">'
                f'<a href="{source_url}" style="font-size:12px;color:#c9b896;'
                f'text-decoration:none">Read source →</a></p>'
            )

        separator = "" if i == 0 else (
            '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0">'
        )

        items_html += f"""
{separator}
<div style="padding:28px 32px">
  {section_html}
  {source_html}
  <h2 style="margin:0 0 10px;font-family:Georgia,serif;font-size:18px;
    font-weight:400;color:#f5f5f4;line-height:1.3;letter-spacing:-0.02em">
    {headline}
  </h2>
  <p style="margin:0 0 12px;font-size:14px;color:#a0a0a0;line-height:1.65">{summary}</p>
  <blockquote style="margin:0;padding:12px 16px;
    border-left:2px solid rgba(201,184,150,0.4);
    background:rgba(201,184,150,0.05);border-radius:0 6px 6px 0">
    <p style="margin:0;font-size:13px;color:#c9b896;line-height:1.6;font-style:italic">{why}</p>
  </blockquote>
  {read_link}
</div>
"""

    web_link_section = ""
    if web_url:
        web_link_section = f"""
<div style="padding:24px 32px;text-align:center;border-top:1px solid rgba(255,255,255,0.06)">
  <a href="{web_url}" style="font-size:12px;color:#525252;text-decoration:none">
    View in browser
  </a>
</div>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{subject_line}</title>
</head>
<body style="margin:0;padding:0;background:#080808;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
  style="background:#080808;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation"
      style="max-width:600px;width:100%;background:#0f0f0f;
        border:1px solid rgba(255,255,255,0.06);border-radius:12px;overflow:hidden">

      <!-- Header -->
      <tr><td style="padding:28px 32px 24px;
        border-bottom:1px solid rgba(255,255,255,0.06)">
        <p style="margin:0 0 2px;font-size:10px;color:#525252;
          text-transform:uppercase;letter-spacing:0.14em;font-family:monospace">
          Morning briefing
        </p>
        <h1 style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;
          font-weight:400;color:#f5f5f4;letter-spacing:-0.03em">
          Good morning, {greeting}
        </h1>
        <p style="margin:0;font-size:13px;color:#525252">{digest_date}</p>
      </td></tr>

      <!-- Items -->
      {items_html}

      <!-- Footer -->
      {web_link_section}
      <tr><td style="padding:20px 32px;
        border-top:1px solid rgba(255,255,255,0.04)">
        <p style="margin:0;font-size:11px;color:#333;text-align:center;
          font-family:monospace">
          Briefly · Your personalized morning briefing
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>"""

    return html
