"""
briefly_api/agents/skills/

Decomposed LLM skills — each file owns one focused task.
Each skill is a pure async callable: inputs → structured result.

Decomposing the monolithic BriefingWriterAgent call into skills lets us:
  - Run RelevanceSkill on a cheaper/faster model (it is a simple task)
  - Run ConnectionSkill with the full memory context window it needs
  - Run ContradictionSkill only when similarity is above the threshold
  - Optimise each prompt independently without touching the others
  - Cache skills that run on the same stable input across multiple users

Import pattern:
    from briefly_api.agents.skills.connection_skill import ConnectionSkill
    result = await ConnectionSkill().run(item_text, memory_items)
"""
