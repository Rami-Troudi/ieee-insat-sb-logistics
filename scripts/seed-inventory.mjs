import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken || url.startsWith("file:")) {
  throw new Error("Set production TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before seeding.");
}

const client = createClient({ url, authToken });
const items = JSON.parse(await readFile(resolve("scripts/inventory.seed.json"), "utf8"));
const now = Date.now();

try {
  for (const item of items) {
    const sum =
      item.availableQuantity +
      item.allocatedQuantity +
      item.borrowedQuantity +
      item.damagedQuantity +
      item.maintenanceQuantity +
      item.lostQuantity;
    if (sum !== item.totalQuantity) {
      throw new Error(`Inventory conservation failed for ${item.id}: ${item.totalQuantity} != ${sum}`);
    }
    if (
      item.trackingMode === "INDIVIDUAL_ASSET" &&
      item.assets.length !== item.totalQuantity
    ) {
      throw new Error(`Asset count mismatch for ${item.id}`);
    }

    await client.execute({
      sql: `INSERT INTO inventory (
        id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,
        allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,
        borrower_visible,data,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        category=excluded.category,
        equipment_class=excluded.equipment_class,
        tracking_mode=excluded.tracking_mode,
        total_quantity=excluded.total_quantity,
        available_quantity=excluded.available_quantity,
        allocated_quantity=excluded.allocated_quantity,
        borrowed_quantity=excluded.borrowed_quantity,
        damaged_quantity=excluded.damaged_quantity,
        maintenance_quantity=excluded.maintenance_quantity,
        lost_quantity=excluded.lost_quantity,
        borrower_visible=excluded.borrower_visible,
        data=excluded.data,
        updated_at=excluded.updated_at`,
      args: [
        item.id,item.name,item.category,item.equipmentClass,item.trackingMode,
        item.totalQuantity,item.availableQuantity,item.allocatedQuantity,item.borrowedQuantity,
        item.damagedQuantity,item.maintenanceQuantity,item.lostQuantity,
        item.borrowerVisible ? 1 : 0,JSON.stringify(item),now,
      ],
    });

    for (const asset of item.assets) {
      await client.execute({
        sql: `INSERT INTO inventory_assets(id,item_id,serial_number,state,data)
              VALUES(?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                serial_number=excluded.serial_number,
                state=excluded.state,
                data=excluded.data`,
        args: [asset.id,item.id,asset.serialNumber,asset.state,JSON.stringify(asset)],
      });
    }
  }
  console.log(`Seeded ${items.length} production inventory items.`);
} finally {
  client.close();
}
