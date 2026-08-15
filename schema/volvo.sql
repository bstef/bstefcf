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
