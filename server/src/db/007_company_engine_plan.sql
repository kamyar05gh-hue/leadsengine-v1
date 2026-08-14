-- Per-engine prompt allocation + requested engine set (migration 007).
-- engine_plan: JSON object { chatgpt: 20, gemini: 20, perplexity: 10, claude: 10 }
-- engines:     JSON array of requested measured engines
ALTER TABLE companies ADD COLUMN engine_plan TEXT;
ALTER TABLE companies ADD COLUMN engines TEXT;
