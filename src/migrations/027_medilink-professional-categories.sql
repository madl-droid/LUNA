-- 027: Professional categories for Medilink
-- Allows assigning custom category groups to professionals for smart rescheduling

CREATE TABLE IF NOT EXISTS medilink_professional_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medilink_professional_category_assignments (
  medilink_professional_id INTEGER NOT NULL,
  category_id              INTEGER NOT NULL REFERENCES medilink_professional_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (medilink_professional_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_cat_assignments_prof
  ON medilink_professional_category_assignments(medilink_professional_id);

CREATE INDEX IF NOT EXISTS idx_ml_cat_assignments_cat
  ON medilink_professional_category_assignments(category_id);
