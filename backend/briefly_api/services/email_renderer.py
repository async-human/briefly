"""
briefly_api/services/email_renderer.py

Renders digest items into a clean HTML email body.
Uses inline CSS only — required for broad email client compatibility.

Provides:
  render_digest_html()        — daily briefing email
  render_weekly_report_html() — Sunday weekly intelligence report
"""
from __future__ import annotations


def render_digest_html(
    user_name: str | None,
    digest_date: str,
    items: list[dict],
    subject_line: str,
    web_url: str = "",
    digest_day: int = 0,
    top_clusters: list[dict] | None = None,
    story_thread_count: int = 0,
) -> str:
    greeting = user_name.split()[0] if user_name else "there"

    # ── Progress header (Day X · Top interests) ───────────────────────────────
    progress_bar_html = ""
    if digest_day > 0:
        cluster_chips = _build_cluster_chips(top_clusters or [])
        threads_note = (
            f'<span style="color:#525252;font-size:11px"> · {story_thread_count} threads active</span>'
            if story_thread_count > 0 else ""
        )
        progress_bar_html = f"""
<tr><td style="padding:12px 32px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
  <p style="margin:0;font-size:11px;font-family:monospace;color:#525252;letter-spacing:0.05em">
    Day {digest_day} of your Briefly
    {" · " + cluster_chips if cluster_chips else ""}
    {threads_note}
  </p>
</td></tr>
"""

    # ── Render each item ──────────────────────────────────────────────────────
    items_html = ""
    memory_callout_shown = False

    for i, item in enumerate(items):
        section = item.get("section") or ""
        headline = item.get("headline", "")
        summary = item.get("summary", "")
        why = item.get("why_it_matters", "")
        who = item.get("who_it_affects") or ""
        action = item.get("suggested_action") or ""
        source_name = item.get("source_name") or ""
        source_url = item.get("source_url") or ""
        memory_connections = item.get("memory_connections") or []
        memory_reference = item.get("memory_reference") or ""
        confidence_signal = item.get("confidence_signal") or ""
        evolution_note = item.get("evolution_note") or ""

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

        # Memory callout — show once per digest on the item that has the
        # strongest memory connection (memory_reference or memory_connections)
        memory_callout_html = ""
        show_memory_callout = (
            not memory_callout_shown
            and (memory_reference or memory_connections)
        )
        if show_memory_callout:
            memory_text = memory_reference
            if not memory_text and memory_connections:
                memory_text = memory_connections[0].get("description", "")
            if memory_text:
                memory_callout_html = _render_memory_callout(memory_text)
                memory_callout_shown = True

        who_html = ""
        if who:
            who_html = (
                f'<p style="margin:10px 0 0;font-size:13px;color:#a0a0a0;line-height:1.55">'
                f'<span style="color:#8a8a8a;font-size:10px;letter-spacing:0.08em;'
                f'text-transform:uppercase;font-family:monospace">Who it affects</span><br>{who}</p>'
            )
        action_html = ""
        if action:
            action_html = (
                f'<p style="margin:10px 0 0;font-size:13px;color:#c9b896;line-height:1.55">'
                f'<span style="color:#8a8a8a;font-size:10px;letter-spacing:0.08em;'
                f'text-transform:uppercase;font-family:monospace">Do this</span><br>{action}</p>'
            )
        confidence_html = ""
        if confidence_signal:
            confidence_html = (
                f'<p style="margin:8px 0 0;font-size:11px;color:#666;font-family:monospace">'
                f'◈ {confidence_signal}</p>'
            )

        # Evolution note
        evolution_html = ""
        if evolution_note:
            evolution_html = (
                f'<div style="margin:10px 0 0;padding:10px 14px;background:rgba(255,255,255,0.03);'
                f'border-radius:6px;border-left:2px solid #525252">'
                f'<p style="margin:0;font-size:12px;color:#888;font-style:italic">{evolution_note}</p>'
                f'</div>'
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
  {who_html}
  {action_html}
  {confidence_html}
  {evolution_html}
  {memory_callout_html}
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

      <!-- Progress bar -->
      {progress_bar_html}

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


def _build_cluster_chips(top_clusters: list[dict]) -> str:
    """Build 'Agentic AI (↑), India Tech (→)' from top clusters with movement arrows."""
    from briefly_api.services.profile_utils import cluster_label

    chips = []
    for cluster in top_clusters[:3]:
        label = cluster_label(cluster)
        if not label:
            continue
        strength = float(cluster.get("strength", 0.5))
        # Determine trend arrow from last_reinforced_at freshness
        from briefly_api.agents.learning import _days_since
        days = _days_since(cluster.get("last_reinforced_at"))
        if days < 3:
            arrow = "↑"
        elif days > 10:
            arrow = "↓"
        else:
            arrow = "→"
        chips.append(
            f'<span style="color:#888">{label} '
            f'<span style="color:#c9b896">{arrow}</span></span>'
        )
    return ", ".join(chips)


def _render_memory_callout(memory_text: str) -> str:
    """Render the in-digest memory callout box — appears once per digest."""
    return f"""
<div style="margin:14px 0 0;padding:12px 16px;
  background:rgba(100,100,255,0.05);
  border:1px solid rgba(100,100,255,0.15);
  border-radius:8px">
  <p style="margin:0 0 4px;font-size:10px;color:#6666cc;
    text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">
    Briefly remembers
  </p>
  <p style="margin:0;font-size:13px;color:#aaaadd;line-height:1.5">
    {memory_text}
  </p>
</div>
"""


def render_weekly_report_html(
    user_name: str | None,
    report: dict,
    web_url: str = "",
) -> str:
    """
    Render the Sunday weekly intelligence report email.
    This is the email that creates the 'this understands me' moment.
    """
    greeting = user_name.split()[0] if user_name else "there"
    week_num = report.get("week_number", 1)
    digest_day = report.get("digest_day", 0)
    stories_read = report.get("stories_read", 0)
    top_source = report.get("top_source", "")
    thinking_shift = report.get("thinking_shift", "")
    building_thread = report.get("building_thread", "")
    blind_spot = report.get("blind_spot", "")
    digest_date = report.get("digest_date", "")

    # Top topics section
    top_topics = report.get("top_topics") or []
    topics_html = ""
    for t in top_topics:
        topic = t.get("topic", "")
        obs = t.get("observation", "")
        if not topic:
            continue
        topics_html += f"""
<div style="margin:0 0 14px;padding:14px 16px;background:rgba(255,255,255,0.03);border-radius:8px">
  <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#f0f0f0">{topic}</p>
  <p style="margin:0;font-size:13px;color:#a0a0a0;line-height:1.5">{obs}</p>
</div>
"""

    # Shift section
    shift_html = ""
    if thinking_shift:
        shift_html = f"""
<tr><td style="padding:24px 32px 0">
  <p style="margin:0 0 8px;font-size:10px;color:#8a8a8a;
    text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">
    A shift I noticed
  </p>
  <p style="margin:0;font-size:14px;color:#d0d0d0;line-height:1.65;
    font-family:Georgia,serif;font-style:italic">
    "{thinking_shift}"
  </p>
</td></tr>
"""

    # Building thread section
    thread_html = ""
    if building_thread:
        thread_html = f"""
<tr><td style="padding:24px 32px 0">
  <p style="margin:0 0 8px;font-size:10px;color:#8a8a8a;
    text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">
    What&apos;s building
  </p>
  <p style="margin:0;font-size:13px;color:#c9b896;line-height:1.6">
    {building_thread}
  </p>
</td></tr>
"""

    # Blind spot section
    blind_spot_html = ""
    if blind_spot:
        blind_spot_html = f"""
<tr><td style="padding:24px 32px 0">
  <p style="margin:0 0 8px;font-size:10px;color:#8a8a8a;
    text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">
    What you&apos;re not seeing
  </p>
  <p style="margin:0;font-size:13px;color:#888;line-height:1.6">
    {blind_spot}
  </p>
</td></tr>
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
<title>Week {week_num} of your Briefly</title>
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
          Week {week_num} of your Briefly · Day {digest_day}
        </p>
        <h1 style="margin:0 0 4px;font-family:Georgia,serif;font-size:22px;
          font-weight:400;color:#f5f5f4;letter-spacing:-0.03em">
          {greeting}&rsquo;s weekly intelligence
        </h1>
        <p style="margin:0;font-size:13px;color:#525252">
          {digest_date} &nbsp;·&nbsp; {stories_read} stories read this week
          {"&nbsp;·&nbsp; Top source: " + top_source if top_source else ""}
        </p>
      </td></tr>

      <!-- What dominated your reading -->
      <tr><td style="padding:28px 32px 0">
        <p style="margin:0 0 14px;font-size:10px;color:#8a8a8a;
          text-transform:uppercase;letter-spacing:0.1em;font-family:monospace">
          What dominated your reading this week
        </p>
        {topics_html}
      </td></tr>

      <!-- A shift I noticed -->
      {shift_html}

      <!-- What's building -->
      {thread_html}

      <!-- What you're not seeing -->
      {blind_spot_html}

      <!-- Spacer -->
      <tr><td style="padding:28px 32px 0"></td></tr>

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
