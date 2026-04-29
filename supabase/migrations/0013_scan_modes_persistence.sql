-- Scan Modes Persistence Patch — Tarama Modları kalıcılığı.
-- bot_settings.scan_modes_config JSONB kolonu ile UI tarafından üretilen
-- mod aktif/pasif durumu ve manuel izleme listesi (MİL) sembolleri kalıcı
-- saklanır. Pure config store — trade behavior etkilenmez.
--
-- Beklenen JSON yapısı:
-- {
--   "wideMarket": { "active": true },
--   "momentum":   { "active": true, "direction": "both" },
--   "manualList": { "active": false, "symbols": [] }
-- }

ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS scan_modes_config JSONB;
