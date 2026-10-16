-- Group classes (16.10.2026, Yair: "אם זה חדרי כושר זה קבוצות"). A class type
-- (פילאטיס, 12 spots), its weekly schedule, the dated sessions made from it, and
-- who booked a spot (or waits for one). A session blocks its trainer through a
-- slot hold (holder "class:<sessionId>") and its room through the room calendar.
CREATE TABLE IF NOT EXISTS class_types (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  staff_id TEXT,
  room_id TEXT,
  cancel_hours INTEGER NOT NULL DEFAULT 6,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS class_types_business_id_idx ON class_types(business_id);
CREATE TABLE IF NOT EXISTS class_schedules (
  id TEXT PRIMARY KEY,
  class_type_id TEXT NOT NULL REFERENCES class_types(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  staff_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS class_schedules_type_idx ON class_schedules(class_type_id);
CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  class_type_id TEXT NOT NULL REFERENCES class_types(id) ON DELETE CASCADE,
  schedule_id TEXT,
  date TIMESTAMP(3) NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  staff_id TEXT,
  room_id TEXT,
  capacity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS class_sessions_schedule_date_key ON class_sessions(schedule_id, date);
CREATE INDEX IF NOT EXISTS class_sessions_business_date_idx ON class_sessions(business_id, date);
CREATE TABLE IF NOT EXISTS class_bookings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP(3),
  promoted_at TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS class_bookings_session_idx ON class_bookings(session_id);
CREATE INDEX IF NOT EXISTS class_bookings_customer_idx ON class_bookings(customer_id);
