-- KingsView's Absa account is at the Tarkwa branch (corrected 2026-10-14). Only replaces the old default if it was
-- saved unchanged in Settings; a branch someone typed in is left alone.
UPDATE "settings" SET "value" = '"Tarkwa Branch"'::jsonb WHERE "key" = 'bankBranch' AND "value" = '"Ring Road Central Branch"'::jsonb;
