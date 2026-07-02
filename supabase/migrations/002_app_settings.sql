-- App Settings Table (for persisting auto-created Google Sheets ID etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow service_role to read/write (API routes use service_role key)
CREATE POLICY "app_settings_service_all" ON app_settings FOR ALL USING (true);