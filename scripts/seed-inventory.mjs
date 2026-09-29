import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error("Set TURSO_DATABASE_URL before seeding inventory.");
if (/ieee[-_]?ras[-_]?insat/i.test(url)) throw new Error("Refusing to seed the RAS database.");
if (!url.startsWith("file:") && process.env.ALLOW_REMOTE_SEED !== "true") {
  throw new Error(
    "Inventory seed is local-only by default. Set ALLOW_REMOTE_SEED=true to seed a separately configured SB database."
  );
}

const client = createClient({ url, authToken });
const timestamp = Date.now();
const products = [
  {
    code: "ELEC-ARD",
    name: "Arduino Uno",
    category: "Microcontrollers",
    description: "A dependable starting point for embedded builds.",
    icon: "arduino-board.svg",
    count: 6,
  },
  {
    code: "ELEC-STM",
    name: "STM32 Nucleo board",
    category: "Microcontrollers",
    description: "Development board for control and sensing projects.",
    icon: "stm32-board.svg",
    count: 4,
  },
  {
    code: "MEAS-MUL",
    name: "Digital multimeter",
    category: "Measurement",
    description: "Portable meter for everyday electronics work.",
    icon: "multimeter.svg",
    count: 5,
  },
  {
    code: "MEAS-OSC",
    name: "Oscilloscope",
    category: "Measurement",
    description: "Bench instrument for viewing electrical signals.",
    icon: "oscilloscope.svg",
    count: 2,
  },
  {
    code: "COMP-RPI",
    name: "Raspberry Pi 4",
    category: "Computing",
    description: "Single-board computer for robotics and vision prototypes.",
    icon: "raspberry-pi.svg",
    count: 3,
  },
  {
    code: "TOOL-SOL",
    name: "Soldering station",
    category: "Workshop tools",
    description: "Temperature-controlled station for through-hole and SMD work.",
    icon: "soldering-station.svg",
    count: 3,
  },
  {
    code: "ROBO-MOT",
    name: "DC gear motor",
    category: "Robotics",
    description: "Compact motor for small mobile robot builds.",
    icon: "motor.svg",
    count: 12,
  },
  {
    code: "SENS-MOD",
    name: "Sensor module kit",
    category: "Sensors",
    description: "A selection of modules for quick sensing experiments.",
    icon: "sensor-module.svg",
    count: 5,
  },
];

try {
  await client.execute("PRAGMA foreign_keys = ON");
  const existing = await client.execute("SELECT COUNT(*) AS count FROM equipment_items");
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    console.log("Inventory already has equipment; seed skipped without changing existing records.");
  } else {
    await client.execute({
      sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      args: ["chapter-robotics", "Robotics Club", "ROBO", timestamp, timestamp],
    });
    await client.execute({
      sql: "INSERT INTO chapters(id,name,short_code,active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
      args: ["chapter-embedded", "Embedded Systems Club", "EMBED", timestamp, timestamp],
    });
    for (const product of products) {
      const itemId = crypto.randomUUID();
      await client.execute({
        sql: "INSERT INTO equipment_items(id,name,description,category,image_url,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
        args: [
          itemId,
          product.name,
          product.description,
          product.category,
          "/equipment/" + product.icon,
          timestamp,
          timestamp,
        ],
      });
      for (let number = 1; number <= product.count; number += 1) {
        const qrToken = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        await client.execute({
          sql: "INSERT INTO assets(id,equipment_item_id,asset_code,qr_token,state,active,created_at,updated_at) VALUES(?,?,?,?, 'AVAILABLE',1,?,?)",
          args: [
            crypto.randomUUID(),
            itemId,
            product.code + "-" + String(number).padStart(2, "0"),
            qrToken,
            timestamp,
            timestamp,
          ],
        });
      }
    }
    console.log(
      "Seeded " +
        products.length +
        " equipment types and " +
        products.reduce((sum, item) => sum + item.count, 0) +
        " individually tracked assets."
    );
  }
} finally {
  client.close();
}
