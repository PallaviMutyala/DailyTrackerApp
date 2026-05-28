-- Run this in your Supabase SQL Editor (one-time migration)
-- Adds new fields to the applications table and creates interview_rounds table.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS priority    smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS referral    boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS job_url     text,
  ADD COLUMN IF NOT EXISTS follow_up_date  date,
  ADD COLUMN IF NOT EXISTS follow_up_note  text,
  ADD COLUMN IF NOT EXISTS interview_date  date,
  ADD COLUMN IF NOT EXISTS interviewer_names text,
  ADD COLUMN IF NOT EXISTS interview_notes  text;

CREATE TABLE IF NOT EXISTS interview_rounds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  application_id  uuid        REFERENCES applications ON DELETE CASCADE NOT NULL,
  round_name      text        NOT NULL,
  interview_date  date,
  interviewer     text,
  questions       text,
  notes           text,
  sort_order      bigint      NOT NULL DEFAULT extract(epoch from now()),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE interview_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user can manage own interview rounds" ON interview_rounds
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
