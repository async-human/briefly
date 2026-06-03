"""
briefly_api/agents/proactive/

Always-on agents that each have a specific awareness responsibility.
They do NOT run together on a cron — each has its own cadence:

  ContentWatcherAgent      every 4 hours
  ContextBuilderAgent      every 2 hours (inside enrichment_worker)
  SignalMonitorAgent       on every behavioral signal (event-driven)
  StoryThreadAgent         nightly at 02:00 UTC
  ProactiveSurfacingAgent  on trigger (after ContentWatcher or StoryThread)

By the time the morning BriefingComposerAgent runs at 07:00, all items already
have pre-computed connections, contradiction flags, and narrative hooks.  The
pipeline becomes assembly, not derivation.
"""
