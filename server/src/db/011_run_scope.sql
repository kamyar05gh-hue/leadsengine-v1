-- Run scope (migration 011): how far a workflow run goes for this company.
-- 'report'  → stop after the PDF report deck
-- 'actions' → additionally the action plan
-- 'full'    → additionally the AI crawl pack / landing pages
-- NULL on pre-migration rows, which read as 'full' (the previous behaviour).
ALTER TABLE companies ADD COLUMN run_scope TEXT;
