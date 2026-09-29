CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0 CHECK(emailVerified IN (0,1)),
  image TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','BOARD','SUPERADMIN')),
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_role ON user(role);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS verification_identifier ON verification(identifier);

CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL CHECK(count >= 0),
  lastRequest INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  short_code TEXT NOT NULL CHECK(length(short_code) BETWEEN 2 AND 24),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS chapters_name ON chapters(name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS chapters_short_code ON chapters(short_code COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS equipment_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 80),
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS equipment_active_name ON equipment_items(active,name);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  equipment_item_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(asset_code) BETWEEN 1 AND 80),
  qr_token TEXT NOT NULL UNIQUE CHECK(length(qr_token) = 64),
  serial_number TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(state IN ('AVAILABLE','RESERVED','BORROWED','OUT_OF_SERVICE','RETIRED')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_scan_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_item_state ON assets(equipment_item_id,state,active);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  borrower_type TEXT NOT NULL CHECK(borrower_type IN ('PERSON','CHAPTER')),
  borrower_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE RESTRICT,
  pickup_at INTEGER NOT NULL,
  return_at INTEGER NOT NULL,
  note TEXT CHECK(note IS NULL OR length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DECLINED','CANCELLED','COMPLETED')),
  approved_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(pickup_at < return_at),
  CHECK((borrower_type='PERSON' AND borrower_user_id IS NOT NULL AND chapter_id IS NULL) OR (borrower_type='CHAPTER' AND borrower_user_id IS NULL AND chapter_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS reservations_pickup ON reservations(pickup_at);
CREATE INDEX IF NOT EXISTS reservations_return ON reservations(return_at);
CREATE INDEX IF NOT EXISTS reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS reservations_requester_created ON reservations(requested_by_user_id,created_at);

CREATE TABLE IF NOT EXISTS reservation_lines (
  id TEXT PRIMARY KEY NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  equipment_item_id TEXT NOT NULL REFERENCES equipment_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  UNIQUE(reservation_id,equipment_item_id)
);
CREATE INDEX IF NOT EXISTS reservation_lines_equipment ON reservation_lines(equipment_item_id);

CREATE TABLE IF NOT EXISTS reservation_assets (
  id TEXT PRIMARY KEY NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  reservation_line_id TEXT NOT NULL REFERENCES reservation_lines(id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','BORROWED','RETURNED','RELEASED')),
  actual_pickup_at INTEGER,
  checked_out_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  actual_return_at INTEGER,
  checked_in_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(reservation_id,asset_id)
);
CREATE INDEX IF NOT EXISTS reservation_assets_asset ON reservation_assets(asset_id);
CREATE INDEX IF NOT EXISTS reservation_assets_reservation ON reservation_assets(reservation_id);
CREATE INDEX IF NOT EXISTS reservation_assets_line ON reservation_assets(reservation_line_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id,created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS audit_entity_time ON audit_events(entity_type,entity_id,created_at);
CREATE INDEX IF NOT EXISTS audit_actor_time ON audit_events(actor_user_id,created_at);
CREATE TRIGGER IF NOT EXISTS audit_events_immutable_update
BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_immutable_delete
BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  response TEXT NOT NULL CHECK(json_valid(response)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,operation,key)
);
CREATE INDEX IF NOT EXISTS idempotency_created ON idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0)
);
