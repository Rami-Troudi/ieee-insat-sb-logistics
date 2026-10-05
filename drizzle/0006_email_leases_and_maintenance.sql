ALTER TABLE notification_emails ADD COLUMN lease_token TEXT;
ALTER TABLE notification_emails ADD COLUMN lease_until INTEGER;
ALTER TABLE notification_emails ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE notification_emails ADD COLUMN skip_reason TEXT;
CREATE TABLE maintenance_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX idempotency_keys_retention ON idempotency_keys(created_at);
CREATE INDEX rate_limit_retention ON rate_limit_buckets(window_start);
CREATE INDEX notifications_retention ON notifications(created_at);
