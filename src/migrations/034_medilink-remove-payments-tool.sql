-- Migration 034: Remove medilink-get-my-payments from medilink-scheduler subagent
-- The Medilink API does not return useful payment information.

UPDATE subagent_types SET
  allowed_tools = '{medilink-search-patient,medilink-check-availability,medilink-get-professionals,medilink-get-prestaciones,medilink-create-patient,medilink-create-appointment,medilink-reschedule-appointment,medilink-get-my-appointments,medilink-get-treatment-plans,skill_read}',
  updated_at = now()
WHERE slug = 'medilink-scheduler';
