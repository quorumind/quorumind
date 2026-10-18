-- When each setting was last saved: the organisation profile, kept in the settings next to the branding, shows it,
-- and every debate keeps the date of the profile it followed. The settings saved before have none.

ALTER TABLE settings ADD COLUMN updated_at timestamptz;
