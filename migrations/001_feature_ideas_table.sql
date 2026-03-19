-- ============================================
-- Feature Ideas Table Migration
-- Replaces the JSON blob in settings table
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Create the dedicated feature_ideas table
CREATE TABLE IF NOT EXISTS feature_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('feature', 'bug')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in-progress', 'implemented', 'needs-input', 'skipped')),
  resolution_note TEXT,
  pr_url TEXT,
  branch_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_feature_ideas_status ON feature_ideas(status);
CREATE INDEX IF NOT EXISTS idx_feature_ideas_type ON feature_ideas(type);

-- 3. RLS (same open policy as other tables)
ALTER TABLE feature_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on feature_ideas" ON feature_ideas
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_feature_ideas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_feature_ideas_updated_at
  BEFORE UPDATE ON feature_ideas
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_ideas_updated_at();

-- 5. Migrate existing data from settings JSON blob
DO $$
DECLARE
  ideas_json JSONB;
  idea JSONB;
BEGIN
  SELECT (value->'ideas')::JSONB INTO ideas_json
  FROM settings
  WHERE key = 'feature_ideas';

  IF ideas_json IS NOT NULL THEN
    FOR idea IN SELECT * FROM jsonb_array_elements(ideas_json)
    LOOP
      INSERT INTO feature_ideas (id, seq, text, type, status, created_at)
      VALUES (
        (idea->>'id')::UUID,
        COALESCE((idea->>'seq')::INTEGER, 1),
        idea->>'text',
        idea->>'type',
        idea->>'status',
        COALESCE((idea->>'created_at')::TIMESTAMPTZ, NOW())
      )
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END IF;
END $$;

-- 6. Clean up old settings row after migration
DELETE FROM settings WHERE key = 'feature_ideas';
