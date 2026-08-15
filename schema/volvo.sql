-- Volvo dashboard schema (Cloudflare D1 / SQLite)
-- Apply with: wrangler d1 execute <your-db-name> --remote --file=schema/volvo.sql

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS location_pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL,
  odometer_km REAL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_location_pings_vin_time ON location_pings (vin, recorded_at);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  last_point_at INTEGER NOT NULL,
  start_lat REAL NOT NULL,
  start_lon REAL NOT NULL,
  end_lat REAL NOT NULL,
  end_lon REAL NOT NULL,
  start_odometer_km REAL,
  end_odometer_km REAL,
  distance_km REAL NOT NULL DEFAULT 0,
  path_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_trips_vin_time ON trips (vin, start_time);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips (vin, status);

CREATE TABLE IF NOT EXISTS fuel_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT NOT NULL,
  filled_at INTEGER NOT NULL,
  odometer_km REAL NOT NULL,
  gallons REAL NOT NULL,
  price_per_gallon REAL,
  total_cost REAL,
  is_partial INTEGER NOT NULL DEFAULT 0,
  station TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fuel_ups_vin_odo ON fuel_ups (vin, odometer_km);
-- Guards against double-importing the same CSV row twice; also means a
-- second manual entry with the same timestamp+odometer down to the second
-- silently no-ops rather than erroring, which is an acceptable trade-off.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_ups_dedup ON fuel_ups (vin, filled_at, odometer_km);
