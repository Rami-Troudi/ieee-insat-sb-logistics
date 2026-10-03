ALTER TABLE reservations ADD COLUMN pickup_closed_at INTEGER;
ALTER TABLE user ADD COLUMN disabled_at INTEGER;
ALTER TABLE user ADD COLUMN membership TEXT CHECK(membership IS NULL OR membership IN ('IEEE','EXTERNAL'));
CREATE UNIQUE INDEX reservation_assets_one_borrowed ON reservation_assets(asset_id) WHERE state='BORROWED';
CREATE UNIQUE INDEX account_provider_user ON account(userId,providerId);
CREATE TRIGGER reservation_asset_line_insert BEFORE INSERT ON reservation_assets BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reservation_lines l JOIN assets a ON a.equipment_item_id=l.equipment_item_id WHERE l.id=NEW.reservation_line_id AND l.reservation_id=NEW.reservation_id AND a.id=NEW.asset_id) THEN RAISE(ABORT,'Assignment must match reservation line and equipment') END;
END;
CREATE TRIGGER reservation_asset_line_update BEFORE UPDATE OF reservation_id,reservation_line_id,asset_id ON reservation_assets BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reservation_lines l JOIN assets a ON a.equipment_item_id=l.equipment_item_id WHERE l.id=NEW.reservation_line_id AND l.reservation_id=NEW.reservation_id AND a.id=NEW.asset_id) THEN RAISE(ABORT,'Assignment must match reservation line and equipment') END;
END;
