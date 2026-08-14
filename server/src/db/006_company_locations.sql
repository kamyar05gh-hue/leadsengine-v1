-- Multi-location companies (migration 006) — JSON array of location names,
-- first entry = primary (duplicated in the legacy `location` column).
-- Consumed by the report/pages stages (per-location decks + site pages) and
-- surfaced via GET /api/audits/:id (auditFromJob.locations).

ALTER TABLE companies ADD COLUMN locations TEXT NOT NULL DEFAULT '[]';
