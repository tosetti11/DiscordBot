-- ============================================
-- 011: Add DNP handling to prop_picks
-- Players who did not play should not count
-- in model accuracy stats
-- ============================================

ALTER TABLE prop_picks ADD COLUMN IF NOT EXISTS dnp BOOLEAN DEFAULT NULL;

-- Index for filtering out DNPs in queries
CREATE INDEX IF NOT EXISTS idx_prop_picks_dnp ON prop_picks (dnp) WHERE dnp = true;
