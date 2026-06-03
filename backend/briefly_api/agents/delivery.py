"""
briefly_api/agents/delivery.py

DeliveryAgent: sends the rendered digest via Resend.

The html_body and web_body are already rendered by CitationVerifierAgent.
This agent just calls the Resend API and records the message ID on the digest.
"""
from __future__ import annotations

import asyncio
import logging

import resend

from briefly_api.agents.context import PipelineContext
from briefly_api.config import get_settings

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """Send the digest email via Resend."""
    s = get_settings()

    if not s.resend_api_key:
        log.warning("DeliveryAgent: RESEND_API_KEY not set — skipping email delivery")
        ctx.log_error("DeliveryAgent", "RESEND_API_KEY not configured")
        return ctx

    if not ctx.html_body:
        log.warning("DeliveryAgent: no html_body to send")
        ctx.log_error("DeliveryAgent", "No HTML body rendered")
        return ctx

    if not ctx.digest_items:
        log.warning("DeliveryAgent: no digest items — not sending empty email")
        return ctx

    resend.api_key = s.resend_api_key

    html_body = ctx.html_body
    if ctx.audio_url:
        listen_button = (
            f'<div style="text-align:center;margin:24px 0">'
            f'<a href="{ctx.audio_url}" style="background:#1a1a1a;color:#fff;'
            f'padding:12px 28px;border-radius:6px;text-decoration:none;'
            f'font-family:sans-serif;font-size:14px;">▶ Listen to your briefing</a>'
            f'</div>'
        )
        html_body = html_body.replace("</body>", f"{listen_button}</body>", 1)

    try:
        params: resend.Emails.SendParams = {
            "from": f"{s.digest_from_name} <{s.digest_from_email}>",
            "to": [ctx.user.email],
            "subject": ctx.subject_line or f"Your Briefly — {ctx.run_date}",
            "html": html_body,
        }
        if ctx.preview_text:
            # Embed preview text as hidden preheader in HTML (already in template)
            pass

        response = await asyncio.to_thread(resend.Emails.send, params)
        message_id = response.get("id") if isinstance(response, dict) else getattr(response, "id", None)

        log.info(
            "DeliveryAgent: sent digest to %s (message_id=%s)",
            ctx.user.email, message_id,
        )

        # Store message_id for tracking — pipeline will persist it via _persist_digest
        ctx.__dict__["resend_message_id"] = message_id

    except Exception as e:
        log.exception("DeliveryAgent: Resend API call failed: %s", e)
        ctx.log_error("DeliveryAgent", str(e))

    return ctx
