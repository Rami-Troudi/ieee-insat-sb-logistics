CREATE TABLE audit_events_new (
 id TEXT PRIMARY KEY NOT NULL,
 actor_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
 actor_type TEXT NOT NULL DEFAULT 'USER' CHECK(actor_type IN ('USER','SYSTEM')),
 actor_id TEXT,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
 CHECK((actor_type='USER' AND actor_user_id IS NOT NULL) OR (actor_type='SYSTEM' AND actor_user_id IS NULL AND actor_id IS NOT NULL))
);
INSERT INTO audit_events_new(id,actor_user_id,entity_type,entity_id,action,created_at,data)
SELECT id,actor_user_id,entity_type,entity_id,action,created_at,data FROM audit_events;
DROP TRIGGER IF EXISTS audit_events_immutable_update;
DROP TRIGGER IF EXISTS audit_events_immutable_delete;
DROP INDEX IF EXISTS audit_entity_time;
DROP INDEX IF EXISTS audit_actor_time;
DROP TABLE audit_events;
ALTER TABLE audit_events_new RENAME TO audit_events;
CREATE INDEX audit_entity_time ON audit_events(entity_type,entity_id,created_at);
CREATE INDEX audit_actor_time ON audit_events(actor_user_id,created_at);
CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
CREATE TRIGGER audit_events_immutable_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
