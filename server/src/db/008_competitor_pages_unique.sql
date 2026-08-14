-- Dedupe competitor_pages on (company_id, url) so repeated competitor-stage
-- runs upsert instead of accumulating duplicate rows (migration 008).
-- Existing duplicates are collapsed to the most recently scraped row first,
-- since the unique index creation would otherwise fail on pre-existing dupes.
DELETE FROM competitor_pages
WHERE id NOT IN (
  SELECT MAX(id) FROM competitor_pages GROUP BY company_id, url
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_pages_unique ON competitor_pages(company_id, url);
