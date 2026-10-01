-- Remove only preassigned units that have never been collected.
DELETE FROM reservation_assets WHERE state IN ('RESERVED','RELEASED') AND actual_pickup_at IS NULL;
UPDATE assets SET state='AVAILABLE' WHERE state='RESERVED' AND NOT EXISTS (
  SELECT 1 FROM reservation_assets ra WHERE ra.asset_id=assets.id AND ra.state='BORROWED'
);
