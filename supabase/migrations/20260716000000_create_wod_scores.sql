-- v4.9.112 — WOD + Core session scoreboard.
-- One row per logged session attempt. Mirrored to localStorage ('phoenix_lib_scores')
-- for offline use; this table is the cross-device source of truth.

CREATE TABLE IF NOT EXISTS wod_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  wod_id text NOT NULL,
  score text NOT NULL,
  score_type text NOT NULL,
  date timestamptz DEFAULT now(),
  notes text,
  is_pb boolean DEFAULT false
);

-- Fast lookups for the scoreboard (per-user, newest first) and per-WOD history.
CREATE INDEX IF NOT EXISTS wod_scores_user_date_idx ON wod_scores (user_id, date DESC);
CREATE INDEX IF NOT EXISTS wod_scores_user_wod_idx  ON wod_scores (user_id, wod_id);

-- Row Level Security: each athlete can only see and write their own scores.
ALTER TABLE wod_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wod_scores_select_own" ON wod_scores;
CREATE POLICY "wod_scores_select_own" ON wod_scores
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "wod_scores_insert_own" ON wod_scores;
CREATE POLICY "wod_scores_insert_own" ON wod_scores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wod_scores_update_own" ON wod_scores;
CREATE POLICY "wod_scores_update_own" ON wod_scores
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wod_scores_delete_own" ON wod_scores;
CREATE POLICY "wod_scores_delete_own" ON wod_scores
  FOR DELETE USING (auth.uid() = user_id);
