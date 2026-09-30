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
    code: "SB-EXT",
    name: "Rallonge",
    category: "Power",
    description: "Extension cord for event equipment.",
    icon: "rallonge.svg",
    count: 3,
  },
  {
    code: "SB-STRIP",
    name: "Multiprise",
    category: "Power",
    description: "Power strip for event equipment.",
    icon: "multiprise.svg",
    count: 10,
  },
  {
    code: "SB-PROJ",
    name: "Projecteur",
    category: "Display",
    description: "Projector for presentations and events.",
    icon: "projecteur.svg",
    count: 3,
  },
  {
    code: "SB-HDMI",
    name: "Câble HDMI",
    category: "Display",
    description: "HDMI cable for connecting displays and projectors.",
    icon: "hdmi.svg",
    count: 4,
  },
  {
    code: "SB-POINTER",
    name: "Pointeur",
    category: "Presentation",
    description: "Presentation pointer.",
    icon: "pointeur.svg",
    count: 1,
  },
  {
    code: "SB-ROUTER",
    name: "Routeur",
    category: "Network",
    description: "Router for event connectivity.",
    icon: "routeur.svg",
    count: 2,
  },
  {
    code: "SB-TV",
    name: "Télévision",
    category: "Display",
    description: "Television for presentations and events.",
    icon: "television.svg",
    count: 1,
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
