-- Rooms (16.10.2026, Yair: "יש טיפולים שקורים בחדר מסויים, לדוגמא חדר שבו
-- מתבצע לייזר — פנימי פשוט"). Internal only: a treatment may need one of some
-- rooms; a time is offered only when such a room is free; the booking keeps the
-- room the system picked. A business without rooms is unaffected.
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rooms_business_id_idx ON rooms(business_id);
CREATE TABLE IF NOT EXISTS service_rooms (
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, room_id)
);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS room_id TEXT;
CREATE INDEX IF NOT EXISTS appointments_room_id_date_idx ON appointments(room_id, date);
