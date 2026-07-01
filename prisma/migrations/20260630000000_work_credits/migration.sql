-- Créditos por rol (STORY/ART/ASSISTANT/… para manga; script/ink/color a futuro).
-- JSON: [{name, role, order}]. El `author` principal se mantiene (índice + dedup).
ALTER TABLE "Work" ADD COLUMN "credits" JSONB;
