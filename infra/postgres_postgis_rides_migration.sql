-- =============================================================================
-- Otlobha Rides System — Production PostgreSQL + PostGIS Migration Script
-- Safe additive migration preserving all existing Shopping, Stores & Pharmacy tables
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Extend existing captains table with KYC & vehicle details + spatial index
ALTER TABLE captains ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE captains ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE captains ADD COLUMN IF NOT EXISTS vehicle_brand TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS vehicle_color TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS residence_id TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS insurance_number TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS license_number TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS registration_number TEXT NOT NULL DEFAULT '';
ALTER TABLE captains ADD COLUMN IF NOT EXISTS geom GEOGRAPHY(POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_pg_captains_geom ON captains USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pg_captains_dispatch ON captains (verification_status, availability_status, vehicle_type, is_eligible_for_rides);

-- 2. Extend existing dispatch_config with central ride auto-dispatch controls
ALTER TABLE dispatch_config ADD COLUMN IF NOT EXISTS auto_dispatch_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dispatch_config ADD COLUMN IF NOT EXISTS radius_step_km DOUBLE PRECISION NOT NULL DEFAULT 2.0;
ALTER TABLE dispatch_config ADD COLUMN IF NOT EXISTS max_dispatch_attempts INTEGER NOT NULL DEFAULT 8;
ALTER TABLE dispatch_config ADD COLUMN IF NOT EXISTS priority_mode TEXT NOT NULL DEFAULT 'balanced';

-- 3. Extend existing trips table with full Uber/Careem lifecycle, OTP, pricing snapshot & route columns
ALTER TABLE trips ADD COLUMN IF NOT EXISTS waypoint_address TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS waypoint_lat DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS waypoint_lng DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS duration_min DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_polyline_json TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS routing_source TEXT NOT NULL DEFAULT 'osrm_live';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS fare_snapshot_id TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS commission_rate DOUBLE PRECISION NOT NULL DEFAULT 10;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS commission_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS driver_net_earnings DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS waiting_minutes DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS waiting_fee DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS extra_fees DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancellation_fee DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_otp_hash TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_otp_plain_masked TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_otp_verified_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_otp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dispatch_radius_km DOUBLE PRECISION NOT NULL DEFAULT 2.0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dispatch_expires_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_geom GEOGRAPHY(POINT, 4326);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dropoff_geom GEOGRAPHY(POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_pg_trips_pickup_geom ON trips USING GIST (pickup_geom);
CREATE INDEX IF NOT EXISTS idx_pg_trips_status_vehicle ON trips (status, vehicle_type, created_at DESC);

-- 4. Vehicle types registry (car, moto, tuktuk + admin extensibility)
CREATE TABLE IF NOT EXISTS ride_vehicle_types (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_ar TEXT NOT NULL DEFAULT '',
  icon_key TEXT NOT NULL DEFAULT 'car',
  image_url TEXT NOT NULL DEFAULT '',
  max_passengers INTEGER NOT NULL DEFAULT 4,
  required_docs_json TEXT NOT NULL DEFAULT '[]',
  routing_profile TEXT NOT NULL DEFAULT 'car',
  is_active INTEGER NOT NULL DEFAULT 1,
  available_zones_json TEXT NOT NULL DEFAULT '["all"]',
  sort_order INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Per-vehicle fare settings
CREATE TABLE IF NOT EXISTS ride_fare_settings (
  id TEXT PRIMARY KEY,
  vehicle_type TEXT UNIQUE NOT NULL REFERENCES ride_vehicle_types(code) ON DELETE CASCADE,
  base_fare DOUBLE PRECISION NOT NULL DEFAULT 10,
  per_km_rate DOUBLE PRECISION NOT NULL DEFAULT 4,
  per_min_rate DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  min_fare DOUBLE PRECISION NOT NULL DEFAULT 15,
  waiting_grace_min INTEGER NOT NULL DEFAULT 3,
  waiting_per_min_rate DOUBLE PRECISION NOT NULL DEFAULT 1,
  cancellation_fee DOUBLE PRECISION NOT NULL DEFAULT 5,
  commission_rate DOUBLE PRECISION NOT NULL DEFAULT 12,
  tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  extra_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  extra_fee_label_ar TEXT NOT NULL DEFAULT '',
  peak_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT 'System',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Immutable price change history audit
CREATE TABLE IF NOT EXISTS ride_fare_history (
  id TEXT PRIMARY KEY,
  vehicle_type TEXT NOT NULL,
  previous_json TEXT NOT NULL DEFAULT '{}',
  new_json TEXT NOT NULL DEFAULT '{}',
  changed_by_id TEXT,
  changed_by_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Immutable fare snapshot per ride (prevents retroactive price changes)
CREATE TABLE IF NOT EXISTS ride_fare_snapshots (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  duration_min DOUBLE PRECISION NOT NULL,
  base_fare DOUBLE PRECISION NOT NULL,
  distance_cost DOUBLE PRECISION NOT NULL,
  duration_cost DOUBLE PRECISION NOT NULL,
  waiting_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  extra_fees DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_fare_applied INTEGER NOT NULL DEFAULT 0,
  total_estimated_fare DOUBLE PRECISION NOT NULL,
  commission_rate DOUBLE PRECISION NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Dispatch offers with atomic acceptance & timeout tracking
CREATE TABLE IF NOT EXISTS ride_offers (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  distance_to_pickup_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  eta_to_pickup_min INTEGER NOT NULL DEFAULT 3,
  radius_km DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  status TEXT NOT NULL DEFAULT 'pending',
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pg_ride_offers_trip ON ride_offers (trip_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_ride_offers_captain ON ride_offers (captain_id, status);

-- 9. Ride status transition history
CREATE TABLE IF NOT EXISTS ride_status_history (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Live driver GPS location logs with 30-day privacy retention TTL
CREATE TABLE IF NOT EXISTS ride_location_logs (
  id TEXT PRIMARY KEY,
  trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
  captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  speed_kmh DOUBLE PRECISION DEFAULT 0,
  geom GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS idx_pg_ride_loc_trip ON ride_location_logs (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_ride_loc_expires ON ride_location_logs (expires_at);

-- 11. Ride disputes & complaints
CREATE TABLE IF NOT EXISTS ride_disputes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  trip_number TEXT NOT NULL DEFAULT '',
  reporter_role TEXT NOT NULL,
  reporter_id TEXT,
  reporter_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_decision TEXT NOT NULL DEFAULT '',
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Driver earnings ledger (computed strictly from completed trips)
CREATE TABLE IF NOT EXISTS driver_earnings_ledger (
  id TEXT PRIMARY KEY,
  trip_id TEXT UNIQUE NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  captain_id TEXT NOT NULL REFERENCES captains(id) ON DELETE CASCADE,
  gross_fare DOUBLE PRECISION NOT NULL,
  commission_rate DOUBLE PRECISION NOT NULL,
  commission_amount DOUBLE PRECISION NOT NULL,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  net_driver_amount DOUBLE PRECISION NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  settlement_status TEXT NOT NULL DEFAULT 'unsettled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pg_driver_earnings_cap ON driver_earnings_ledger (captain_id, created_at DESC);
