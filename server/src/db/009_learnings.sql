-- Retro-learning memory (migration 009).
--
-- After every completed audit the retro analyzer distills durable lessons
-- from the run (which prompt shapes earned mentions, which pitfalls burned
-- calls, which content patterns won citations) and stores them here. The
-- next run — for any company — retrieves the relevant lessons and injects
-- them into prompt generation and action planning, so the system improves
-- generation over generation instead of starting cold every time.
CREATE TABLE IF NOT EXISTS learnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'global' lessons apply to every audit; 'sector' lessons only to
  -- companies whose sector matches sector_key; 'company' to one company.
  scope       TEXT NOT NULL CHECK (scope IN ('global', 'sector', 'company')),
  sector_key  TEXT,                -- normalized sector slug for scope='sector'
  company_id  TEXT,                -- for scope='company'
  -- what kind of lesson this is:
  --   prompt_pattern — a prompt shape that measurably earned visibility
  --   pitfall        — something that wasted calls or produced junk
  --   insight        — a market/citation-supply-chain observation
  --   action         — an intervention pattern that worked
  kind        TEXT NOT NULL CHECK (kind IN ('prompt_pattern', 'pitfall', 'insight', 'action')),
  lesson      TEXT NOT NULL,       -- the distilled, reusable statement
  evidence    TEXT,                -- concrete backing (winning prompt texts, numbers)
  -- confidence/weight: starts at 1, bumped when later runs re-confirm the
  -- lesson (dedupe raises weight instead of inserting a twin).
  weight      INTEGER NOT NULL DEFAULT 1,
  source_job  TEXT,                -- job id of the run that produced it
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learnings_scope ON learnings(scope, sector_key);
CREATE INDEX IF NOT EXISTS idx_learnings_company ON learnings(company_id);

-- Persistent AI-summary cache (was in-memory only, so every server restart
-- forced a paid regeneration and the dashboard button-first UX). Summaries
-- are pre-generated at audit completion; the API serves from here.
CREATE TABLE IF NOT EXISTS ai_summaries (
  company_id   TEXT PRIMARY KEY REFERENCES companies(id),
  cache_key    TEXT NOT NULL,      -- libraryId|score.createdAt of the summarized state
  summary      TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
