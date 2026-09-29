PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  phone TEXT CHECK(phone IS NULL OR length(phone) <= 40),
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('MEMBER','OPERATOR','SUPERADMIN')),
  clearance TEXT NOT NULL DEFAULT 'I' CHECK(clearance IN ('I','II','III','IV','V','VI')),
  clearance_source TEXT,
  affiliation TEXT NOT NULL DEFAULT 'EXTERNAL' CHECK(affiliation IN ('EXTERNAL','AEROBOTIX','IEEE','RAS_BOARD','EUROBOT')),
  claimed_affiliation TEXT,
  affiliation_verified INTEGER NOT NULL DEFAULT 0 CHECK(affiliation_verified IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RESTRICTED','BANNED','BLACKLISTED','PENDING')),
  data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Better Auth D1 adapter tables. Password authentication is disabled.
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS verification_identifier ON verification(identifier);
CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK(length(category) <= 80),
  equipment_class TEXT NOT NULL CHECK(equipment_class IN ('A','B','C','D','E','F','G')),
  tracking_mode TEXT NOT NULL CHECK(tracking_mode IN ('QUANTITY','INDIVIDUAL_ASSET')),
  total_quantity INTEGER NOT NULL DEFAULT 0 CHECK(total_quantity >= 0),
  available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity >= 0),
  allocated_quantity INTEGER NOT NULL DEFAULT 0 CHECK(allocated_quantity >= 0),
  borrowed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(borrowed_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK(damaged_quantity >= 0),
  maintenance_quantity INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_quantity >= 0),
  lost_quantity INTEGER NOT NULL DEFAULT 0 CHECK(lost_quantity >= 0),
  borrower_visible INTEGER NOT NULL DEFAULT 0 CHECK(borrower_visible IN (0,1)),
  data TEXT NOT NULL CHECK(json_valid(data)),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  CHECK(total_quantity = available_quantity + allocated_quantity + borrowed_quantity + damaged_quantity + maintenance_quantity + lost_quantity)
);
CREATE INDEX IF NOT EXISTS inventory_class_visibility ON inventory(equipment_class, borrower_visible);
CREATE TABLE IF NOT EXISTS inventory_assets (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  serial_number TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('AVAILABLE','ALLOCATED','BORROWED','DAMAGED','MAINTENANCE','LOST')),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS asset_item_state ON inventory_assets(item_id,state);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  status TEXT NOT NULL CHECK(status <> 'INVALID'),
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS requests_owner_created ON requests(user_id, created_at);
CREATE TABLE IF NOT EXISTS request_lines (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES inventory(id),
  equipment_class TEXT NOT NULL CHECK(equipment_class IN ('A','B','C','D','E','F','G')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS request_lines_item ON request_lines(item_id);

CREATE TABLE IF NOT EXISTS record_store (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT,
  status TEXT,
  expires_at INTEGER,
  data TEXT NOT NULL CHECK(json_valid(data)),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS record_owner_kind ON record_store(kind,owner_id);
CREATE INDEX IF NOT EXISTS record_status_kind ON record_store(kind,status);
CREATE INDEX IF NOT EXISTS record_expiry ON record_store(kind,expires_at);

CREATE TABLE IF NOT EXISTS staff_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_challenge_expiry ON staff_challenges(user_id,expires_at);
CREATE TABLE IF NOT EXISTS staff_sessions (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  fresh_until INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK(json_valid(response)),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_events(entity_type,entity_id,created_at);
CREATE INDEX IF NOT EXISTS audit_actor ON audit_events(actor_user_id,created_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0)
);

CREATE TABLE IF NOT EXISTS registration_intents (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  claimed_affiliation TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
