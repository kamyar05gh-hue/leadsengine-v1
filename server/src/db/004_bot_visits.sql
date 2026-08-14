-- AI crawler visit log (migration 004) — the "CDN layer".
-- Written by the onResponse hook for /reports/* requests in src/api/server.ts
-- (User-Agent match) and by POST /api/track/bot for client sites that forward
-- their server/CDN logs. Consumed by src/tracking/aiTraffic.ts.

CREATE TABLE IF NOT EXISTS bot_visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  bot        TEXT NOT NULL,                    -- GPTBot|PerplexityBot|ClaudeBot|...
  path       TEXT NOT NULL DEFAULT '',         -- requested path under /reports/
  status     INTEGER,                          -- HTTP status; NULL for forwarded logs
  at         TEXT NOT NULL                     -- ISO timestamp
);
CREATE INDEX IF NOT EXISTS idx_bot_visits
  ON bot_visits (company_id, at);
