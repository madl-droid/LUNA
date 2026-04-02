-- Migration 028: Fix medilink professional category system
-- Removes custom category table (using Medilink's native categories from /prestaciones instead)
-- Recreates assignment table with medilink_category_id + category_name

-- Drop old custom categories table (cascades to old assignments FK)
DROP TABLE IF EXISTS medilink_professional_categories CASCADE;

-- Drop and recreate the assignments table with the correct schema
DROP TABLE IF EXISTS medilink_professional_category_assignments CASCADE;

CREATE TABLE IF NOT EXISTS medilink_professional_category_assignments (
  medilink_professional_id INTEGER NOT NULL,
  medilink_category_id     INTEGER NOT NULL,
  category_name            TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (medilink_professional_id, medilink_category_id)
);
