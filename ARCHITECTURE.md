# Briefly — Architecture Decision Record

## Stack
- Backend: FastAPI (Python 3.12)
- Frontend: Next.js 14 (App Router) + Tailwind CSS
- Database: PostgreSQL 16 + pgvector
- Queue/Cache: Redis (background jobs via RQ)
- Email delivery: Resend
- Email ingestion: catch-all SMTP (Cloudmailin or Postal)
- Hosting: Railway (backend + workers + DB + Redis), Vercel (frontend)

## LLM Layer — fully agnostic
Provider + model set in .env only. Zero code changes to swap.
- BRIEFLY_LLM_PROVIDER=anthropic|openai|groq
- BRIEFLY_LLM_MODEL=claude-sonnet-4-5|gpt-4o|llama-3.1-70b
- BRIEFLY_EMBEDDING_PROVIDER=voyage|openai
- BRIEFLY_EMBEDDING_MODEL=voyage-3|text-embedding-3-small

## Database schema (tables)
- users
- user_profiles (interests, role, goals, preferences)
- sources (email/rss/youtube/reddit per user)
- raw_content (all ingested items)
- content_embeddings (pgvector)
- digests (one per user per day)
- digest_items (individual items within a digest)
- user_memory (topics, themes, seen items per user)
- behavioral_signals (opens, clicks, skips, feedback)
- follow_up_threads (conversational Q&A)

## Agent pipeline (runs nightly per user, 5am local time)
1. SourceCollectorAgent — fetch new content from all sources
2. ContentCleanerAgent — strip boilerplate, normalize
3. DeduplicationAgent — cosine similarity, merge cross-source stories
4. RelevanceAgent — score each item against user profile + history
5. NoveltyAgent — flag updates to past stories, detect themes
6. MemoryAgent — pull relevant past context for today's items
7. BriefingPlannerAgent — select 8-12 items, decide sections
8. BriefingWriterAgent — write digest with "why this matters to you"
9. CitationVerifierAgent — verify every claim has source link
10. DeliveryAgent — send email + store in DB
11. LearningAgent — runs post-open, updates profile from signals

## Key design principles
- Every agent is a pure function: input dict → output dict
- Agents communicate via shared context object, not direct calls
- Any agent can be swapped or skipped via config
- All LLM calls go through LLMAdapter (provider-agnostic)
- All embeddings go through EmbeddingAdapter (provider-agnostic)
- Digest quality gate: if overall relevance score < threshold, 
  collector runs again with relaxed filters before giving up
