-- Migration: add tag system and setup flow
ALTER TABLE users ADD COLUMN IF NOT EXISTS tag VARCHAR(30) UNIQUE NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_complete TINYINT(1) NOT NULL DEFAULT 0;

-- Mark existing users as setup complete (they already have usernames)
UPDATE users SET setup_complete = 1 WHERE username IS NOT NULL AND username != '';

-- Add index on tag
CREATE INDEX IF NOT EXISTS idx_tag ON users (tag);
