-- Add 'error' status to feature_ideas
ALTER TABLE feature_ideas DROP CONSTRAINT IF EXISTS feature_ideas_status_check;
ALTER TABLE feature_ideas ADD CONSTRAINT feature_ideas_status_check
  CHECK (status IN ('pending', 'in-progress', 'implemented', 'needs-input', 'skipped', 'error'));
