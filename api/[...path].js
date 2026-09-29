// src/worker/serverless.ts
import { getRequestListener } from "@hono/node-server";

// src/worker/index.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { requestId } from "hono/request-id";

// src/worker/board-rpc.ts
var stamp = () => Date.now();
var iso = (n = stamp()) => new Date(n).toISOString();
var id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
var decode = (s) => JSON.parse(s);
var scopedKey = async (actorId, key) => [
  ...new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${actorId}:${key}`))
  )
].map((byte) => byte.toString(16).padStart(2, "0")).join("");
var ok = (body, status = 200) => ({ status, body });
var fail = (status, code, message) => ({
  status,
  body: { error: { code, message } }
});
async function readOne(env, kind, recordId) {
  const row = await env.DB.prepare("SELECT * FROM record_store WHERE kind=? AND id=?").bind(kind, recordId).first();
  return row ? decode(row.data) : null;
}
async function readMany(env, kind, limit = 500) {
  const result = await env.DB.prepare(
    "SELECT data FROM record_store WHERE kind=? ORDER BY updated_at DESC LIMIT ?"
  ).bind(kind, limit).all();
  return (result.results ?? []).map((row) => decode(row.data));
}
function put(env, kind, record, ownerId = null, status = null, expiry = null) {
  return env.DB.prepare(
    `INSERT INTO record_store(kind,id,owner_id,status,expires_at,data,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(kind,id) DO UPDATE SET owner_id=excluded.owner_id,status=excluded.status,expires_at=excluded.expires_at,data=excluded.data,updated_at=excluded.updated_at`
  ).bind(kind, record.id, ownerId, status, expiry, JSON.stringify(record), stamp());
}
function audit(env, actor, entityType, entityId, action, data = {}) {
  return env.DB.prepare(
    "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
  ).bind(id("audit"), actor.id, entityType, entityId, action, stamp(), JSON.stringify(data));
}
function notify(env, userId, title, message, type, metadata = {}) {
  const createdAt = iso();
  const notification = {
    id: id("notif"),
    userId,
    title,
    message,
    type,
    read: false,
    createdAt,
    ...Object.keys(metadata).length ? { metadata } : {}
  };
  return put(env, "notification", notification, userId, "UNREAD");
}
var isFresh = (method) => [
  "createItem",
  "mutateStock",
  "updateAsset",
  "reviewRequest",
  "rejectEntireRequest",
  "confirmHandover",
  "confirmReturn",
  "updateDueDate",
  "releaseAllocation",
  "createProject",
  "updateProject",
  "assignMember",
  "removeMember",
  "startAudit",
  "recordCounts",
  "reconcileItem",
  "completeAudit",
  "createIncident",
  "resolveIncident",
  "issueStrike",
  "overturnStrike",
  "recordCompensation",
  "updateCompensationStatus",
  "processUser",
  "updateClearance",
  "updateRole",
  "updateStatus",
  "createUser",
  "removeUser",
  "resetPassword",
  "exportCsv",
  "logEvent"
].includes(method);
var superadminOnly = (service, method, args) => service === "user" && ["updateRole", "updateStatus", "resetPassword"].includes(method) || service === "export" && ["USERS", "AUDITS", "STRIKES", "INCIDENTS", "COMPENSATIONS", "AUDIT_LOG"].includes(args[0]);
async function dispatchBoardRpc(env, actor, input) {
  if (!input || typeof input !== "object") return fail(400, "VALIDATION", "Invalid operation");
  const { service, method, args } = input;
  if (typeof service !== "string" || typeof method !== "string" || !Array.isArray(args) || args.length > 8)
    return fail(400, "VALIDATION", "Invalid operation");
  if (isFresh(method)) {
    const session = await env.DB.prepare(
      "SELECT fresh_until,revoked_at FROM staff_sessions WHERE user_id=?"
    ).bind(actor.id).first();
    if (!session || session.revoked_at || session.fresh_until <= stamp())
      return fail(403, "FRESH_AUTH_REQUIRED", "Reverify with a new staff code");
  }
  if (superadminOnly(service, method, args) && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Superadmin access is required");
  if (service === "inventory") {
    if (method === "getItems") {
      const rows = await env.DB.prepare("SELECT data FROM inventory ORDER BY name LIMIT 1000").all();
      const filter = args[0] ?? {};
      return ok(
        (rows.results ?? []).map((r) => decode(r.data)).filter(
          (item) => (!filter.search || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(String(filter.search).toLowerCase())) && (!filter.category || item.category === filter.category) && (!filter.equipmentClass || item.equipmentClass === filter.equipmentClass) && (!filter.lowStockOnly || item.availableQuantity <= 3)
        )
      );
    }
    if (method === "getItemById") {
      const row = await env.DB.prepare("SELECT data FROM inventory WHERE id=?").bind(args[0]).first();
      return ok(row ? decode(row.data) : null);
    }
    if (method === "createItem") {
      const data = args[0];
      if (!data || typeof data.name !== "string" || data.name.trim().length < 1 || data.name.length > 160 || typeof data.category !== "string" || data.category.length > 80 || !["A", "B", "C", "D", "E", "F", "G"].includes(data.equipmentClass) || !["QUANTITY", "INDIVIDUAL_ASSET"].includes(data.trackingMode) || !Number.isInteger(data.totalQuantity) || data.totalQuantity < 0 || data.totalQuantity > 1e5)
        return fail(400, "VALIDATION", "Invalid inventory item");
      const initialAssets = data.initialAssets ?? [];
      const serials = Array.isArray(initialAssets) ? initialAssets.map(
        (asset) => typeof asset?.serialNumber === "string" ? asset.serialNumber.trim() : ""
      ) : [];
      if (!Array.isArray(initialAssets) || data.trackingMode === "INDIVIDUAL_ASSET" && initialAssets.length !== data.totalQuantity || data.trackingMode === "QUANTITY" && initialAssets.length > 0 || serials.some((serial) => !serial || serial.length > 120) || new Set(serials).size !== serials.length)
        return fail(
          400,
          "VALIDATION",
          "Enter a unique serial number for every individually tracked asset"
        );
      const item = {
        ...data,
        id: id("item"),
        availableQuantity: data.totalQuantity,
        allocatedQuantity: 0,
        borrowedQuantity: 0,
        damagedQuantity: 0,
        maintenanceQuantity: 0,
        lostQuantity: 0,
        borrowerVisible: data.borrowerVisible ?? ["C", "E"].includes(data.equipmentClass),
        assets: initialAssets.map((asset, index2) => ({
          serialNumber: serials[index2],
          condition: asset.condition ?? "GOOD",
          id: id("asset"),
          state: "AVAILABLE"
        }))
      };
      const statements = [
        env.DB.prepare(
          `INSERT INTO inventory(id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,borrower_visible,data,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          item.id,
          item.name,
          item.category,
          item.equipmentClass,
          item.trackingMode,
          item.totalQuantity,
          item.availableQuantity,
          0,
          0,
          0,
          0,
          0,
          item.borrowerVisible ? 1 : 0,
          JSON.stringify(item),
          stamp()
        ),
        audit(env, actor, "INVENTORY", item.id, "INVENTORY_CREATED")
      ];
      for (const asset of item.assets)
        statements.push(
          env.DB.prepare(
            "INSERT INTO inventory_assets(id,item_id,serial_number,state,data) VALUES(?,?,?,?,?)"
          ).bind(asset.id, item.id, asset.serialNumber, asset.state, JSON.stringify(asset))
        );
      try {
        await env.DB.batch(statements);
      } catch {
        return fail(409, "CONFLICT", "Inventory item or serial number already exists");
      }
      return ok(item, 201);
    }
    if (method === "setBorrowerVisibility") {
      const [itemId, visible] = args;
      if (typeof visible !== "boolean")
        return fail(400, "VALIDATION", "Visibility must be true or false");
      const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(itemId).first();
      if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
      const item = decode(row.data);
      item.borrowerVisible = visible;
      try {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE inventory SET borrower_visible=?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
          ).bind(
            visible ? 1 : 0,
            JSON.stringify(item),
            row.updated_at,
            Math.max(stamp(), row.updated_at + 1),
            itemId
          ),
          audit(
            env,
            actor,
            "INVENTORY",
            itemId,
            visible ? "VISIBILITY_ENABLED" : "VISIBILITY_DISABLED"
          )
        ]);
      } catch {
        return fail(409, "CONFLICT", "Inventory changed; reload and retry");
      }
      return ok(item);
    }
    if (method === "mutateStock") return mutateStock(env, actor, args[0]);
    if (method === "updateAsset") return updateAsset(env, actor, args[0]);
    if (method === "getMovementHistory") {
      const rows = await env.DB.prepare(
        `SELECT data FROM record_store WHERE kind='inventory_event' ${args[0] ? "AND owner_id=?" : ""} ORDER BY updated_at DESC LIMIT 500`
      ).bind(...args[0] ? [args[0]] : []).all();
      return ok((rows.results ?? []).map((r) => decode(r.data)));
    }
  }
  if (service === "request") {
    if (method === "getRequests") {
      const filter = args[0] ?? {};
      const rows = await env.DB.prepare(
        "SELECT data FROM requests ORDER BY created_at DESC LIMIT 500"
      ).all();
      return ok(
        (rows.results ?? []).map((r) => decode(r.data)).filter(
          (r) => (!filter.decisionStatus || filter.decisionStatus === "ALL" || r.decisionStatus === filter.decisionStatus) && (!filter.handoverStatus || filter.handoverStatus === "ALL" || r.handoverStatus === filter.handoverStatus) && (!filter.search || `${r.userName} ${r.userEmail} ${r.items.map((i) => i.itemName).join(" ")}`.toLowerCase().includes(String(filter.search).toLowerCase()))
        )
      );
    }
    if (method === "getRequestById") {
      const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(args[0]).first();
      return ok(row ? decode(row.data) : null);
    }
    if (method === "reviewRequest") return reviewRequest(env, actor, args[0]);
    if (method === "rejectEntireRequest") return rejectRequest(env, actor, args[0], args[1]);
    if (method === "confirmHandover") return handover(env, actor, args[0]);
  }
  if (service === "loan") {
    if (method === "getLoans") return ok(await readMany(env, "loan"));
    if (method === "getLoanById") return ok(await readOne(env, "loan", String(args[0])));
    if (method === "confirmReturn") return confirmReturn(env, actor, args[0]);
    if (method === "updateDueDate") {
      const [loanId, dueDate] = args;
      if (!Number.isFinite(Date.parse(dueDate))) return fail(400, "VALIDATION", "Invalid due date");
      const loan = await readOne(env, "loan", loanId);
      if (!loan) return fail(404, "NOT_FOUND", "Loan not found");
      loan.dueDate = dueDate;
      loan.updatedAt = iso();
      await env.DB.batch([
        put(env, "loan", loan, loan.userId, loan.status),
        audit(env, actor, "LOAN", loanId, "DUE_DATE_UPDATED")
      ]);
      return ok(loan);
    }
  }
  if (service === "allocation") {
    if (method === "getAllocations") {
      const f = args[0] ?? {};
      return ok(
        (await readMany(env, "allocation")).filter(
          (a) => (!f.requestId || a.requestId === f.requestId) && (!f.itemId || a.itemId === f.itemId) && (!f.status || a.status === f.status)
        )
      );
    }
    if (method === "releaseAllocation") {
      const allocation = await readOne(env, "allocation", String(args[0]));
      if (!allocation) return fail(404, "NOT_FOUND", "Allocation not found");
      if (allocation.status !== "ACTIVE")
        return fail(409, "CONFLICT", "Allocation is no longer active");
      if (Date.parse(allocation.expiresAt) <= stamp()) return expireOne(env, actor, allocation);
      allocation.releaseReason = String(args[1] ?? "").slice(0, 1e3);
      return releaseOne(env, actor, allocation, "RELEASED");
    }
    if (method === "checkAndExpireAllocations") return ok(await expireDue(env, actor));
  }
  const generic = await genericRecords(env, actor, service, method, args);
  if (generic) return generic;
  return fail(501, "NOT_IMPLEMENTED", "This board operation is not available yet");
}
async function mutateStock(env, actor, payload) {
  if (!payload || typeof payload.itemId !== "string" || !Number.isInteger(payload.quantity) || payload.quantity === 0 || Math.abs(payload.quantity) > 1e5 || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 1e3)
    return fail(400, "VALIDATION", "Stock movement details are invalid");
  const sensitive = ["CORRECT", "REMOVE", "RETIRE", "CONSUME"].includes(payload.type);
  if (sensitive && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Superadmin access is required for this stock correction");
  if (payload.type !== "CORRECT" && payload.quantity < 1)
    return fail(400, "VALIDATION", "Stock movement quantity must be positive");
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(payload.itemId).first();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode(row.data);
  const before = {
    total: item.totalQuantity,
    available: item.availableQuantity,
    allocated: item.allocatedQuantity,
    borrowed: item.borrowedQuantity,
    damaged: item.damagedQuantity,
    maintenance: item.maintenanceQuantity,
    lost: item.lostQuantity
  };
  const q = Math.abs(payload.quantity);
  const selected = payload.assetIds ?? (payload.assetId ? [payload.assetId] : []);
  const assetUpdates = [];
  const assetDeletes = [];
  const assetAdds = [];
  const touched = [];
  const requireAssets = (count, state) => {
    if (item.trackingMode === "QUANTITY") {
      if (selected.length)
        throw new Error("Quantity-tracked inventory does not accept asset identifiers");
      return [];
    }
    if (selected.length !== count || new Set(selected).size !== count)
      throw new Error(`Select exactly ${count} individual assets`);
    const assets = selected.map(
      (assetId) => item.assets?.find((asset) => asset.id === assetId)
    );
    if (assets.some((asset) => !asset || asset.state !== state))
      throw new Error("One or more assets are not in the required stock state");
    return assets;
  };
  const addAssets = (count) => {
    if (selected.length)
      throw new Error("Additions require new serial numbers, not existing asset IDs");
    if (item.trackingMode === "QUANTITY") {
      if (payload.newAssets?.length)
        throw new Error("Quantity-tracked inventory does not accept asset serial numbers");
      return [];
    }
    if (!Array.isArray(payload.newAssets) || payload.newAssets.length !== count)
      throw new Error(`Enter serial numbers for all ${count} added units`);
    const existing = new Set((item.assets ?? []).map((asset) => asset.serialNumber));
    const serials = payload.newAssets.map(
      (asset) => typeof asset.serialNumber === "string" ? asset.serialNumber.trim() : ""
    );
    if (serials.some((serial) => !serial || serial.length > 120) || new Set(serials).size !== serials.length || serials.some((serial) => existing.has(serial)))
      throw new Error("Added asset serial numbers must be unique and nonempty");
    const added = payload.newAssets.map((asset, index2) => ({
      id: id("asset"),
      serialNumber: serials[index2],
      condition: asset.condition ?? "GOOD",
      state: "AVAILABLE"
    }));
    item.assets ??= [];
    item.assets.push(...added);
    assetAdds.push(...added);
    touched.push(...added.map((asset) => asset.id));
    return added;
  };
  try {
    if (payload.type === "ADD" || payload.type === "CORRECT" && payload.quantity > 0) {
      addAssets(q);
      item.totalQuantity += q;
      item.availableQuantity += q;
    } else if (payload.type === "REMOVE" || payload.type === "RETIRE" || payload.type === "CONSUME" || payload.type === "CORRECT" && payload.quantity < 0) {
      if (item.availableQuantity < q)
        return fail(409, "CONFLICT", "Only available units can be removed");
      const assets = requireAssets(q, "AVAILABLE");
      if (assets.length) {
        item.assets = item.assets.filter((asset) => !selected.includes(asset.id));
        assetDeletes.push(...selected);
        touched.push(...selected);
      }
      item.totalQuantity -= q;
      item.availableQuantity -= q;
    } else if (["DAMAGE", "REPAIR", "RECOVER"].includes(payload.type)) {
      const [from, to, fromState, toState, condition] = payload.type === "DAMAGE" ? ["availableQuantity", "damagedQuantity", "AVAILABLE", "DAMAGED", "DAMAGED"] : payload.type === "REPAIR" ? ["damagedQuantity", "availableQuantity", "DAMAGED", "AVAILABLE", "GOOD"] : ["lostQuantity", "availableQuantity", "LOST", "AVAILABLE", "GOOD"];
      if (item[from] < q) return fail(409, "CONFLICT", "Insufficient stock in the source state");
      const assets = requireAssets(q, fromState);
      if (assets.length)
        for (const asset of assets) {
          asset.state = toState;
          asset.condition = condition;
          assetUpdates.push(asset);
          touched.push(asset.id);
        }
      item[from] -= q;
      item[to] += q;
    } else
      return fail(
        400,
        "VALIDATION",
        "This stock movement requires its dedicated loan or return workflow"
      );
  } catch (error) {
    return fail(
      400,
      "VALIDATION",
      error instanceof Error ? error.message : "Invalid stock movement"
    );
  }
  if (item.totalQuantity < 0 || [
    "availableQuantity",
    "allocatedQuantity",
    "borrowedQuantity",
    "damagedQuantity",
    "maintenanceQuantity",
    "lostQuantity"
  ].some((k) => item[k] < 0) || item.totalQuantity !== item.availableQuantity + item.allocatedQuantity + item.borrowedQuantity + item.damagedQuantity + item.maintenanceQuantity + item.lostQuantity)
    return fail(409, "CONFLICT", "Stock change violates inventory conservation");
  const timestamp = iso();
  const event = {
    id: id("iev"),
    itemId: item.id,
    itemName: item.name,
    type: payload.type,
    quantity: payload.quantity,
    beforeState: before,
    afterState: {
      total: item.totalQuantity,
      available: item.availableQuantity,
      allocated: item.allocatedQuantity,
      borrowed: item.borrowedQuantity,
      damaged: item.damagedQuantity,
      maintenance: item.maintenanceQuantity,
      lost: item.lostQuantity
    },
    reason: payload.reason.trim(),
    actorUserId: actor.id,
    actorName: actor.name,
    timestamp,
    ...touched.length ? { assetIds: touched } : {}
  };
  const updatedAt = Math.max(stamp(), row.updated_at + 1);
  const stmts = [
    env.DB.prepare(
      "UPDATE inventory SET total_quantity=?,available_quantity=?,allocated_quantity=?,borrowed_quantity=?,damaged_quantity=?,maintenance_quantity=?,lost_quantity=?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
    ).bind(
      item.totalQuantity,
      item.availableQuantity,
      item.allocatedQuantity,
      item.borrowedQuantity,
      item.damagedQuantity,
      item.maintenanceQuantity,
      item.lostQuantity,
      JSON.stringify(item),
      row.updated_at,
      updatedAt,
      item.id
    ),
    ...assetDeletes.map(
      (assetId) => env.DB.prepare(
        "DELETE FROM inventory_assets WHERE id=? AND item_id=? AND state='AVAILABLE'"
      ).bind(assetId, item.id)
    ),
    ...assetAdds.map(
      (asset) => env.DB.prepare(
        "INSERT INTO inventory_assets(id,item_id,serial_number,state,data) VALUES(?,?,?,?,?)"
      ).bind(asset.id, item.id, asset.serialNumber, asset.state, JSON.stringify(asset))
    ),
    ...assetUpdates.map(
      (asset) => env.DB.prepare(
        "UPDATE inventory_assets SET state=CASE WHEN state IN ('AVAILABLE','DAMAGED','LOST') THEN ? ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
      ).bind(asset.state, JSON.stringify(asset), asset.id, item.id)
    ),
    put(env, "inventory_event", event, item.id, event.type),
    audit(env, actor, "INVENTORY", item.id, "STOCK_" + payload.type, { quantity: q })
  ];
  try {
    await env.DB.batch(stmts);
  } catch {
    return fail(409, "CONFLICT", "Inventory or asset state changed; reload and try again");
  }
  return ok({ item, event });
}
async function updateAsset(env, actor, payload) {
  if (!payload?.itemId || !payload?.assetId)
    return fail(400, "VALIDATION", "Asset details are invalid");
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(payload.itemId).first();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode(row.data);
  const asset = item.assets?.find((entry) => entry.id === payload.assetId);
  if (!asset) return fail(404, "NOT_FOUND", "Asset not found");
  const oldState = asset.state;
  const nextState = payload.state ?? (typeof payload.isAvailable === "boolean" ? payload.isAvailable ? "AVAILABLE" : payload.condition === "DAMAGED" ? "DAMAGED" : "MAINTENANCE" : oldState);
  const buckets = {
    AVAILABLE: "availableQuantity",
    ALLOCATED: "allocatedQuantity",
    BORROWED: "borrowedQuantity",
    DAMAGED: "damagedQuantity",
    MAINTENANCE: "maintenanceQuantity",
    LOST: "lostQuantity"
  };
  if (!buckets[nextState] || !(/* @__PURE__ */ new Set(["AVAILABLE", "DAMAGED", "MAINTENANCE"])).has(oldState) || !(/* @__PURE__ */ new Set(["AVAILABLE", "DAMAGED", "MAINTENANCE"])).has(nextState))
    return fail(
      409,
      "CONFLICT",
      "Allocation, custody, and loss states use their dedicated workflows"
    );
  if (payload.condition && !(/* @__PURE__ */ new Set(["GOOD", "MINOR_ISSUE", "DAMAGED", "MAINTENANCE", "LOST"])).has(payload.condition))
    return fail(400, "VALIDATION", "Asset condition is invalid");
  asset.state = nextState;
  if (payload.condition) asset.condition = payload.condition;
  if (typeof payload.notes === "string") asset.notes = payload.notes.slice(0, 1e3);
  if (oldState !== nextState) {
    item[buckets[oldState]]--;
    item[buckets[nextState]]++;
  }
  const updatedAt = Math.max(stamp(), row.updated_at + 1);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE inventory SET available_quantity=?,damaged_quantity=?,maintenance_quantity=?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        item.availableQuantity,
        item.damagedQuantity,
        item.maintenanceQuantity,
        JSON.stringify(item),
        row.updated_at,
        updatedAt,
        item.id
      ),
      env.DB.prepare(
        "UPDATE inventory_assets SET state=CASE WHEN state=? THEN ? ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
      ).bind(oldState, nextState, JSON.stringify(asset), asset.id, item.id),
      audit(env, actor, "INVENTORY", item.id, "ASSET_UPDATED", {
        assetId: asset.id,
        from: oldState,
        to: nextState
      })
    ]);
  } catch {
    return fail(409, "CONFLICT", "Asset state changed; reload and try again");
  }
  return ok(asset);
}
async function reviewRequest(env, actor, payload) {
  if (!payload || typeof payload.requestId !== "string" || !Array.isArray(payload.lines) || payload.lines.length > 40)
    return fail(400, "VALIDATION", "Request review is invalid");
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(payload.requestId).first();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode(row.data);
  if (request.decisionStatus !== "PENDING")
    return fail(409, "CONFLICT", "Request has already been reviewed");
  if (payload.lines.length !== request.items.length || new Set(payload.lines.map((l) => l.lineId)).size !== request.items.length)
    return fail(400, "VALIDATION", "Review each request line exactly once");
  const member = await env.DB.prepare("SELECT status,clearance FROM app_users WHERE id=?").bind(request.userId).first();
  if (!member || member.status !== "ACTIVE")
    return fail(409, "CONFLICT", "Member is not eligible to borrow");
  const strikes = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='strike' AND owner_id=? AND status='ACTIVE'"
  ).bind(request.userId).first();
  if ((strikes?.count ?? 0) >= 4) return fail(409, "CONFLICT", "Member is not eligible to borrow");
  const allocations = [];
  const statements = [];
  const timestamp = iso();
  let total = 0;
  for (const choice of payload.lines) {
    const line = request.items.find((l) => l.id === choice.lineId);
    if (!line || !Number.isInteger(choice.approvedQuantity) || choice.approvedQuantity < 0 || choice.approvedQuantity > line.requestedQuantity || !["C", "E"].includes(line.equipmentClass))
      return fail(400, "VALIDATION", "Invalid line quantity or request class");
    line.approvedQuantity = choice.approvedQuantity;
    line.status = choice.approvedQuantity ? "APPROVED" : "REJECTED";
    if (!choice.approvedQuantity) {
      line.rejectionReason = String(choice.rejectionReason ?? "Not approved").slice(0, 500);
      continue;
    }
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(line.itemId).first();
    if (!itemRow) return fail(409, "CONFLICT", "Inventory item no longer exists");
    const item = decode(itemRow.data);
    const quantity = choice.approvedQuantity;
    let assetIds = [];
    if (item.trackingMode === "INDIVIDUAL_ASSET") {
      assetIds = choice.assignedAssetIds ?? [];
      if (!Array.isArray(assetIds) || assetIds.length !== quantity || new Set(assetIds).size !== quantity)
        return fail(400, "VALIDATION", "Select exactly the approved number of unique assets");
      const selected = item.assets?.filter((asset) => assetIds.includes(asset.id));
      if (selected?.length !== quantity || selected.some((asset) => asset.state !== "AVAILABLE"))
        return fail(409, "CONFLICT", "One or more selected assets are no longer available");
      for (const asset of selected) {
        asset.state = "ALLOCATED";
        statements.push(
          env.DB.prepare(
            "UPDATE inventory_assets SET state=CASE WHEN state='AVAILABLE' THEN 'ALLOCATED' ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
          ).bind(JSON.stringify(asset), asset.id, item.id)
        );
      }
    } else if (choice.assignedAssetIds?.length)
      return fail(400, "VALIDATION", "Quantity-tracked items do not accept asset identifiers");
    item.availableQuantity -= quantity;
    item.allocatedQuantity += quantity;
    line.assetIds = assetIds;
    const allocation = {
      id: id("alloc"),
      requestId: request.id,
      requestLineId: line.id,
      itemId: item.id,
      itemName: item.name,
      quantity,
      assetIds,
      status: "ACTIVE",
      allocatedAt: timestamp,
      expiresAt: new Date(stamp() + 48 * 60 * 6e4).toISOString(),
      allocatedBy: actor.id,
      allocatedByName: actor.name
    };
    allocations.push(allocation);
    statements.push(
      env.DB.prepare(
        "UPDATE inventory SET available_quantity=CASE WHEN available_quantity>=? THEN available_quantity-? ELSE -1 END,allocated_quantity=allocated_quantity+?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        quantity,
        quantity,
        quantity,
        JSON.stringify(item),
        itemRow.updated_at,
        Math.max(stamp(), itemRow.updated_at + 1),
        item.id
      )
    );
    statements.push(
      put(env, "allocation", allocation, null, "ACTIVE", Date.parse(allocation.expiresAt))
    );
    total += quantity;
  }
  const requested = request.items.reduce(
    (sum, line) => sum + line.requestedQuantity,
    0
  );
  const decision = total === 0 ? "REJECTED" : total === requested ? "APPROVED" : "PARTIALLY_APPROVED";
  request.decisionStatus = decision;
  request.status = decision;
  request.reviewedAt = timestamp;
  request.reviewedBy = actor.name;
  request.decisionNotes = String(payload.decisionNotes ?? "").slice(0, 1e3);
  request.pickupDeadline = total ? new Date(stamp() + 48 * 60 * 6e4).toISOString() : void 0;
  if (!total) request.lifecycleStatus = "CLOSED";
  request.timeline.push({
    status: decision,
    timestamp,
    description: `Request reviewed: ${decision}`,
    actor: actor.name
  });
  request.updatedAt = timestamp;
  statements.unshift(
    env.DB.prepare(
      "UPDATE requests SET status=CASE WHEN status='PENDING' THEN ? ELSE 'INVALID' END,data=? WHERE id=?"
    ).bind(decision, JSON.stringify(request), request.id)
  );
  statements.push(
    ...request.items.map(
      (line) => env.DB.prepare("UPDATE request_lines SET data=? WHERE id=? AND request_id=?").bind(
        JSON.stringify(line),
        line.id,
        request.id
      )
    )
  );
  statements.push(
    notify(
      env,
      request.userId,
      `Request ${decision.toLowerCase().replaceAll("_", " ")}`,
      total ? `Your request ${request.id} is ready for collection within 48 hours.` : `Your request ${request.id} was declined.`,
      decision === "REJECTED" ? "REQUEST_REJECTED" : decision === "APPROVED" ? "REQUEST_APPROVED" : "REQUEST_PARTIALLY_APPROVED",
      { requestId: request.id }
    ),
    audit(env, actor, "REQUEST", request.id, "REQUEST_REVIEWED", {
      decision,
      allocationCount: allocations.length
    })
  );
  try {
    await env.DB.batch(statements);
  } catch {
    return fail(409, "CONFLICT", "Stock changed during review; reload the request");
  }
  return ok(request);
}
async function rejectRequest(env, actor, requestId2, reason) {
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(requestId2).first();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode(row.data);
  if (request.decisionStatus !== "PENDING")
    return fail(409, "CONFLICT", "Request has already been reviewed");
  const time = iso();
  request.decisionStatus = "REJECTED";
  request.status = "REJECTED";
  request.lifecycleStatus = "CLOSED";
  request.rejectionReason = String(reason ?? "").slice(0, 1e3);
  request.reviewedAt = time;
  request.reviewedBy = actor.name;
  request.updatedAt = time;
  request.items.forEach((line) => {
    line.approvedQuantity = 0;
    line.status = "REJECTED";
    line.rejectionReason = request.rejectionReason;
  });
  request.timeline.push({
    status: "REJECTED",
    timestamp: time,
    description: request.rejectionReason,
    actor: actor.name
  });
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE requests SET status=CASE WHEN status='PENDING' THEN 'REJECTED' ELSE 'INVALID' END,data=? WHERE id=?"
      ).bind(JSON.stringify(request), request.id),
      ...request.items.map(
        (line) => env.DB.prepare("UPDATE request_lines SET data=? WHERE id=? AND request_id=?").bind(
          JSON.stringify(line),
          line.id,
          request.id
        )
      ),
      notify(
        env,
        request.userId,
        "Request declined",
        `Your request ${request.id} was declined: ${request.rejectionReason}`,
        "REQUEST_REJECTED",
        { requestId: request.id }
      ),
      audit(env, actor, "REQUEST", request.id, "REQUEST_REJECTED", {
        reason: request.rejectionReason
      })
    ]);
  } catch {
    return fail(409, "CONFLICT", "Request has already been reviewed");
  }
  return ok(request);
}
async function handover(env, actor, payload) {
  if (!payload || typeof payload.requestId !== "string")
    return fail(400, "VALIDATION", "Handover details are invalid");
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(payload.requestId).first();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode(row.data);
  const suppliedKey = payload.idempotencyKey;
  if (typeof suppliedKey !== "string" || suppliedKey.length < 16 || suppliedKey.length > 128)
    return fail(400, "VALIDATION", "A valid idempotency key is required");
  const key = await scopedKey(actor.id, suppliedKey);
  const replay = await env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  ).bind(key, actor.id).first();
  if (replay) return ok(decode(replay.response));
  if (request.handoverStatus !== "WAITING" || request.lifecycleStatus !== "ACTIVE")
    return fail(409, "CONFLICT", "Request is not waiting for handover");
  if (!request.pickupDeadline || Date.parse(request.pickupDeadline) <= stamp())
    return fail(409, "ALLOCATION_EXPIRED", "The 48-hour reservation has expired");
  const allocations = (await readMany(env, "allocation")).filter(
    (a) => a.requestId === request.id && a.status === "ACTIVE"
  );
  if (!allocations.length) return fail(409, "CONFLICT", "No active allocation is available");
  if (allocations.some((allocation) => Date.parse(allocation.expiresAt) <= stamp()))
    return fail(409, "ALLOCATION_EXPIRED", "At least one reservation has expired");
  const time = iso();
  const loanId = id("LOAN");
  const loanItems = [];
  const stmts = [];
  for (const allocation of allocations) {
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(allocation.itemId).first();
    if (!itemRow) return fail(409, "CONFLICT", "Reserved item no longer exists");
    const item = decode(itemRow.data);
    item.allocatedQuantity -= allocation.quantity;
    item.borrowedQuantity += allocation.quantity;
    if (item.trackingMode === "INDIVIDUAL_ASSET") {
      const assetIds = allocation.assetIds ?? [];
      const handover2 = payload.lineHandoverDetails?.find(
        (entry) => entry.lineId === allocation.requestLineId
      );
      const serials = handover2?.serialNumbers ?? [];
      if (assetIds.length !== allocation.quantity || serials.length !== assetIds.length)
        return fail(409, "CONFLICT", "Confirm every reserved serial number at handover");
      const selected = item.assets?.filter((asset) => assetIds.includes(asset.id));
      if (selected?.length !== assetIds.length || selected.some((asset) => asset.state !== "ALLOCATED") || serials.some(
        (serial) => !selected.some((asset) => asset.serialNumber === serial)
      ))
        return fail(
          409,
          "CONFLICT",
          "Reserved asset selection changed or serial number did not match"
        );
      for (const asset of selected) {
        asset.state = "BORROWED";
        stmts.push(
          env.DB.prepare(
            "UPDATE inventory_assets SET state=CASE WHEN state='ALLOCATED' THEN 'BORROWED' ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
          ).bind(JSON.stringify(asset), asset.id, item.id)
        );
      }
    }
    stmts.push(
      env.DB.prepare(
        "UPDATE inventory SET allocated_quantity=CASE WHEN allocated_quantity>=? THEN allocated_quantity-? ELSE -1 END,borrowed_quantity=borrowed_quantity+?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        allocation.quantity,
        allocation.quantity,
        allocation.quantity,
        JSON.stringify(item),
        itemRow.updated_at,
        Math.max(stamp(), itemRow.updated_at + 1),
        item.id
      )
    );
    allocation.status = "HANDED_OVER";
    allocation.handedOverAt = time;
    stmts.push(put(env, "allocation", allocation, request.id, "HANDED_OVER"));
    const line = request.items.find((l) => l.id === allocation.requestLineId);
    if (line) line.handedOverQuantity = allocation.quantity;
    loanItems.push({
      id: id("loan-line"),
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      equipmentClass: item.equipmentClass,
      borrowedQuantity: allocation.quantity,
      returnedQuantity: 0,
      lostQuantity: 0,
      conditionOnHandover: "GOOD",
      assetIds: allocation.assetIds
    });
  }
  request.handoverStatus = "HANDED_OVER";
  request.status = "HANDED_OVER";
  request.updatedAt = time;
  request.timeline.push({
    status: "HANDED_OVER",
    timestamp: time,
    description: "Equipment handed over",
    actor: actor.name
  });
  const loan = {
    id: loanId,
    requestId: request.id,
    userId: request.userId,
    userName: request.userName,
    userEmail: request.userEmail,
    projectId: request.projectId,
    projectName: request.projectName,
    borrowDate: time,
    dueDate: request.expectedReturnDate,
    lifecycleStatus: "ACTIVE",
    dueStatus: "ON_TIME",
    returnStatus: "NONE",
    status: "ACTIVE",
    items: loanItems,
    handedOverBy: actor.id,
    notes: typeof payload.notes === "string" ? payload.notes.slice(0, 1e3) : void 0,
    createdAt: time,
    updatedAt: time
  };
  const result = { request, loanId };
  const serialized = JSON.stringify(result);
  stmts.unshift(
    env.DB.prepare(
      "UPDATE requests SET status=CASE WHEN status IN ('APPROVED','PARTIALLY_APPROVED') THEN 'HANDED_OVER' ELSE 'INVALID' END,data=? WHERE id=?"
    ).bind(JSON.stringify(request), request.id)
  );
  stmts.push(
    put(env, "loan", loan, loan.userId, loan.status),
    notify(
      env,
      request.userId,
      "Equipment handed over",
      `Loan ${loanId} is active. Expected return: ${request.expectedReturnDate}.`,
      "REQUEST_APPROVED",
      { requestId: request.id, loanId }
    )
  );
  stmts.push(
    env.DB.prepare(
      "INSERT INTO idempotency_keys(key,actor_id,response,created_at) VALUES(?,?,?,?)"
    ).bind(key, actor.id, serialized, stamp())
  );
  stmts.push(audit(env, actor, "LOAN", loanId, "HANDOVER_CONFIRMED", { requestId: request.id }));
  try {
    await env.DB.batch(stmts);
  } catch {
    return fail(409, "CONFLICT", "Handover changed or was already completed");
  }
  return ok(result);
}
async function confirmReturn(env, actor, payload) {
  if (!payload || typeof payload.loanId !== "string" || !Array.isArray(payload.items) || payload.items.length > 100 || typeof payload.idempotencyKey !== "string")
    return fail(400, "VALIDATION", "Return inspection is invalid");
  const suppliedKey = payload.idempotencyKey;
  if (suppliedKey.length < 16 || suppliedKey.length > 128)
    return fail(400, "VALIDATION", "A valid idempotency key is required");
  const key = await scopedKey(actor.id, suppliedKey);
  const replay = await env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  ).bind(key, actor.id).first();
  if (replay) return ok(decode(replay.response));
  const loan = await readOne(env, "loan", payload.loanId);
  if (!loan) return fail(404, "NOT_FOUND", "Loan not found");
  if (loan.lifecycleStatus !== "ACTIVE") return fail(409, "CONFLICT", "Loan is already closed");
  const seen = /* @__PURE__ */ new Set();
  const statements = [];
  for (const entry of payload.items) {
    if (!entry || typeof entry.lineItemId !== "string" || seen.has(entry.lineItemId) || !Number.isInteger(entry.returnedQuantity) || entry.returnedQuantity < 0)
      return fail(400, "VALIDATION", "Return quantities are invalid");
    seen.add(entry.lineItemId);
    const line = loan.items.find((item2) => item2.id === entry.lineItemId);
    if (!line || entry.returnedQuantity + line.returnedQuantity > line.borrowedQuantity)
      return fail(409, "CONFLICT", "Return quantity exceeds the remaining loan quantity");
    const damaged = Number(
      entry.damagedQuantity ?? (entry.condition === "DAMAGED" ? entry.returnedQuantity : 0)
    );
    const lost = Number(entry.lostQuantity ?? 0);
    if (!Number.isInteger(damaged) || !Number.isInteger(lost) || damaged < 0 || lost < 0 || damaged + lost > entry.returnedQuantity)
      return fail(400, "VALIDATION", "Damaged and lost quantities exceed the returned quantity");
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(line.itemId).first();
    if (!itemRow) return fail(409, "CONFLICT", "Loan item no longer exists");
    const item = decode(itemRow.data);
    const returned = entry.returnedQuantity - damaged - lost;
    let assetIds = [];
    if (item.trackingMode === "INDIVIDUAL_ASSET" && entry.returnedQuantity) {
      assetIds = entry.assetIds ?? [];
      if (assetIds.length !== entry.returnedQuantity || new Set(assetIds).size !== assetIds.length)
        return fail(400, "VALIDATION", "Select every returned or reconciled asset");
      const already = new Set(line.returnedAssetIds ?? []);
      const allowed = new Set(line.assetIds ?? []);
      if (assetIds.some((assetId) => already.has(assetId) || !allowed.has(assetId)))
        return fail(
          409,
          "CONFLICT",
          "An asset was already returned or does not belong to this loan line"
        );
      const returnedStates = /* @__PURE__ */ new Map();
      assetIds.forEach(
        (assetId, index2) => returnedStates.set(
          assetId,
          index2 < damaged ? "DAMAGED" : index2 < damaged + lost ? "LOST" : "AVAILABLE"
        )
      );
      const selected = item.assets?.filter((asset) => returnedStates.has(asset.id));
      if (selected?.length !== entry.returnedQuantity || selected.some((asset) => asset.state !== "BORROWED"))
        return fail(409, "CONFLICT", "One or more assets are no longer recorded as borrowed");
      for (const asset of selected) {
        asset.state = returnedStates.get(asset.id);
        asset.condition = asset.state === "DAMAGED" ? "DAMAGED" : asset.state === "LOST" ? "LOST" : entry.condition ?? "GOOD";
        statements.push(
          env.DB.prepare(
            "UPDATE inventory_assets SET state=CASE WHEN state='BORROWED' THEN ? ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
          ).bind(asset.state, JSON.stringify(asset), asset.id, item.id)
        );
      }
      line.returnedAssetIds = [...already, ...assetIds];
    } else if (item.trackingMode === "QUANTITY" && entry.assetIds?.length)
      return fail(400, "VALIDATION", "Quantity-tracked loans do not accept asset identifiers");
    item.borrowedQuantity -= entry.returnedQuantity;
    item.availableQuantity += returned;
    item.damagedQuantity += damaged;
    item.lostQuantity += lost;
    line.returnedQuantity += entry.returnedQuantity;
    line.lostQuantity += lost;
    const updatedAt = Math.max(stamp(), itemRow.updated_at + 1);
    statements.push(
      env.DB.prepare(
        "UPDATE inventory SET borrowed_quantity=CASE WHEN borrowed_quantity>=? THEN borrowed_quantity-? ELSE -1 END,available_quantity=available_quantity+?,damaged_quantity=damaged_quantity+?,lost_quantity=lost_quantity+?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        entry.returnedQuantity,
        entry.returnedQuantity,
        returned,
        damaged,
        lost,
        JSON.stringify(item),
        itemRow.updated_at,
        updatedAt,
        item.id
      )
    );
  }
  const allReturned = loan.items.every(
    (line) => line.returnedQuantity >= line.borrowedQuantity
  );
  loan.returnStatus = allReturned ? "COMPLETE" : "PARTIAL";
  loan.status = allReturned ? "RETURNED" : "PARTIALLY_RETURNED";
  loan.lifecycleStatus = allReturned ? "CLOSED" : "ACTIVE";
  loan.updatedAt = iso();
  loan.returnNotes = String(payload.inspectionNotes ?? "").slice(0, 1e3);
  const result = JSON.stringify(loan);
  statements.unshift(put(env, "loan", loan, loan.userId, loan.status));
  statements.push(
    notify(
      env,
      loan.userId,
      "Return inspection recorded",
      allReturned ? `Loan ${loan.id} is closed.` : `The return for loan ${loan.id} was recorded. Remaining items stay in your custody.`,
      "RETURN_CONFIRMED",
      { loanId: loan.id }
    ),
    env.DB.prepare(
      "INSERT INTO idempotency_keys(key,actor_id,response,created_at) VALUES(?,?,?,?)"
    ).bind(key, actor.id, result, stamp()),
    audit(env, actor, "LOAN", loan.id, "RETURN_CONFIRMED", { allReturned })
  );
  try {
    await env.DB.batch(statements);
  } catch {
    return fail(409, "CONFLICT", "Stock changed during return; reload and try again");
  }
  return ok(loan);
}
async function releaseOne(env, actor, allocation, status) {
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(allocation.itemId).first();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode(row.data);
  const before = {
    total: item.totalQuantity,
    available: item.availableQuantity,
    allocated: item.allocatedQuantity
  };
  item.availableQuantity += allocation.quantity;
  item.allocatedQuantity -= allocation.quantity;
  const statements = [
    env.DB.prepare(
      "UPDATE inventory SET available_quantity=available_quantity+?,allocated_quantity=CASE WHEN allocated_quantity>=? THEN allocated_quantity-? ELSE -1 END,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
    ).bind(
      allocation.quantity,
      allocation.quantity,
      allocation.quantity,
      JSON.stringify(item),
      row.updated_at,
      Math.max(stamp(), row.updated_at + 1),
      item.id
    )
  ];
  if (item.trackingMode === "INDIVIDUAL_ASSET")
    for (const assetId of allocation.assetIds ?? []) {
      const asset = item.assets?.find((entry) => entry.id === assetId);
      if (!asset || asset.state !== "ALLOCATED")
        return fail(409, "CONFLICT", "Allocation asset state is inconsistent");
      asset.state = "AVAILABLE";
      statements.push(
        env.DB.prepare(
          "UPDATE inventory_assets SET state=CASE WHEN state='ALLOCATED' THEN 'AVAILABLE' ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
        ).bind(JSON.stringify(asset), asset.id, item.id)
      );
    }
  allocation.status = status;
  allocation.releasedAt = iso();
  allocation.releasedBy = actor.id;
  allocation.releaseReason = status === "EXPIRED" ? "48-hour collection window expired" : allocation.releaseReason;
  const event = {
    id: id("iev"),
    itemId: item.id,
    itemName: item.name,
    type: "RELEASE_ALLOCATION",
    quantity: allocation.quantity,
    beforeState: before,
    afterState: {
      total: item.totalQuantity,
      available: item.availableQuantity,
      allocated: item.allocatedQuantity
    },
    reason: allocation.releaseReason ?? "Allocation released",
    actorUserId: actor.id,
    actorName: actor.name,
    timestamp: allocation.releasedAt,
    ...allocation.assetIds?.length ? { assetIds: allocation.assetIds } : {}
  };
  statements.push(
    env.DB.prepare(
      "UPDATE record_store SET status=?,data=?,updated_at=CASE WHEN status='ACTIVE' THEN ? ELSE -1 END WHERE kind='allocation' AND id=?"
    ).bind(status, JSON.stringify(allocation), stamp(), allocation.id),
    put(env, "inventory_event", event, item.id, event.type),
    audit(env, actor, "ALLOCATION", allocation.id, `ALLOCATION_${status}`, {
      itemId: item.id,
      quantity: allocation.quantity,
      reason: allocation.releaseReason ?? "Allocation released"
    })
  );
  try {
    await env.DB.batch(statements);
  } catch {
    return fail(409, "CONFLICT", "Allocation or stock changed; reload and try again");
  }
  if (status === "EXPIRED") {
    const remaining = await env.DB.prepare(
      "SELECT 1 FROM record_store WHERE kind='allocation' AND json_extract(data,'$.requestId')=? AND status='ACTIVE' LIMIT 1"
    ).bind(allocation.requestId).first();
    if (!remaining) {
      const requestRow = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(allocation.requestId).first();
      if (requestRow) {
        const request = decode(requestRow.data);
        if (request.handoverStatus === "WAITING") {
          request.lifecycleStatus = "EXPIRED";
          request.status = "EXPIRED";
          request.updatedAt = iso();
          request.timeline.push({
            status: "EXPIRED",
            timestamp: request.updatedAt,
            description: "The 48-hour collection window expired and reservations were released.",
            actor: "System"
          });
          try {
            await env.DB.batch([
              env.DB.prepare(
                "UPDATE requests SET status=CASE WHEN status IN ('APPROVED','PARTIALLY_APPROVED') THEN 'EXPIRED' ELSE 'INVALID' END,data=? WHERE id=?"
              ).bind(JSON.stringify(request), request.id),
              audit(env, actor, "REQUEST", request.id, "PICKUP_EXPIRED")
            ]);
          } catch {
            return fail(409, "CONFLICT", "Request changed while expiring its allocation");
          }
        }
      }
    }
  }
  return ok(allocation);
}
async function expireOne(env, actor, allocation) {
  return releaseOne(env, actor, allocation, "EXPIRED");
}
async function expireDue(env, actor) {
  const rows = await env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='allocation' AND status='ACTIVE' AND expires_at<=? LIMIT 100"
  ).bind(stamp()).all();
  let expired = 0;
  for (const row of rows.results ?? []) {
    const result = await expireOne(env, actor, decode(row.data));
    if (result.status === 200) expired++;
  }
  return expired;
}
async function genericRecords(env, actor, service, method, args) {
  if (service === "discipline" && method.startsWith("getRecommendations"))
    return ok(await readMany(env, "recommendation"));
  if (service === "discipline" && method.startsWith("getIncidents"))
    return ok(await readMany(env, "incident"));
  if (service === "discipline" && method === "getIncidentById")
    return ok(await readOne(env, "incident", String(args[0])));
  if (service === "discipline" && method === "getStrikes") return ok(await readMany(env, "strike"));
  if (service === "discipline" && method === "getCompensations")
    return ok(await readMany(env, "compensation"));
  if (service === "project" && method === "getProjects")
    return ok(
      (await readMany(env, "project")).filter(
        (p) => !args[0]?.status || p.status === args[0].status
      )
    );
  if (service === "project" && method === "getProjectById")
    return ok(await readOne(env, "project", String(args[0])));
  if (service === "audit" && method === "getAudits")
    return ok(
      (await readMany(env, "inventory_audit")).filter((a) => !args[0] || a.status === args[0])
    );
  if (service === "audit" && method === "getAuditById")
    return ok(await readOne(env, "inventory_audit", String(args[0])));
  if (service === "auditLog" && method === "getEvents") {
    const limit = Math.min(500, args[0]?.limit ?? 200);
    const rows = await env.DB.prepare(
      `SELECT
        a.id,
        a.actor_user_id,
        COALESCE(u.name, a.actor_user_id) as actor_name,
        COALESCE(u.role, 'OPERATOR') as actor_role,
        a.action,
        a.entity_type,
        a.entity_id,
        a.reason,
        a.created_at,
        a.data
      FROM audit_events a
      LEFT JOIN app_users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC
      LIMIT ?`
    ).bind(limit).all();
    const events = (rows.results ?? []).map((row) => {
      const parsedData = decode(row.data) ?? {};
      return {
        id: row.id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        reason: row.reason || parsedData.reason || "",
        before: parsedData.before,
        after: parsedData.after,
        createdAt: typeof row.created_at === "number" ? new Date(row.created_at).toISOString() : String(row.created_at)
      };
    });
    return ok(events);
  }
  if (service === "insights" && method === "getInsights") return ok(await insights(env));
  if (service === "export" && method === "exportCsv") return exportCsv(env, actor, args[0]);
  if (service === "user" && method === "getUsers") return getUsers(env, args[0]);
  if (service === "user" && method === "getUserById") {
    const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(args[0]).first();
    return ok(row ? publicProfile(row) : null);
  }
  if (service === "project" && ["createProject", "updateProject", "assignMember", "removeMember"].includes(method)) {
    const projects = await readMany(env, "project");
    let project;
    if (method === "createProject") {
      const input = args[0];
      if (!input || typeof input.name !== "string" || input.name.length > 160)
        return fail(400, "VALIDATION", "Project details are invalid");
      project = { ...input, id: id("project"), memberIds: [], membersCount: 0 };
    } else {
      const projectId = method === "updateProject" ? args[0]?.projectId : args[0];
      project = projects.find((p) => p.id === projectId);
      if (!project) return fail(404, "NOT_FOUND", "Project not found");
      if (method === "updateProject") Object.assign(project, args[0]);
      if (method === "assignMember" || method === "removeMember") {
        const memberId = args[1];
        const ids = new Set(project.memberIds ?? []);
        if (method === "assignMember") ids.add(memberId);
        else ids.delete(memberId);
        project.memberIds = [...ids];
        project.membersCount = ids.size;
      }
    }
    await env.DB.batch([
      put(env, "project", project, null, project.status ?? "ACTIVE"),
      audit(env, actor, "PROJECT", project.id, "PROJECT_" + method.toUpperCase())
    ]);
    return ok(project);
  }
  if (service === "discipline" && [
    "createIncident",
    "resolveIncident",
    "issueStrike",
    "overturnStrike",
    "recordCompensation",
    "updateCompensationStatus",
    "reviewRecommendation"
  ].includes(method)) {
    let kind = "incident", record;
    if (method === "createIncident") {
      record = {
        ...args[0],
        id: id("incident"),
        status: "OPEN",
        reportedBy: actor.id,
        reportedByName: actor.name,
        reportedAt: iso()
      };
    } else if (method === "resolveIncident") {
      kind = "incident";
      record = await readOne(env, kind, String(args[0]));
      if (!record) return fail(404, "NOT_FOUND", "Incident not found");
      record.status = "RESOLVED";
      record.resolutionNotes = String(args[1] ?? "").slice(0, 1e3);
    } else if (method === "issueStrike") {
      kind = "strike";
      record = {
        ...args[0],
        id: id("strike"),
        status: "ACTIVE",
        issuedBy: actor.id,
        issuedByName: actor.name,
        issuedAt: iso()
      };
    } else if (method === "overturnStrike") {
      kind = "strike";
      record = await readOne(env, kind, String(args[0]));
      if (!record) return fail(404, "NOT_FOUND", "Strike not found");
      record.status = "OVERTURNED";
      record.overturnedBy = actor.id;
      record.overturnedAt = iso();
      record.reason = String(args[1] ?? "").slice(0, 1e3);
    } else if (method === "recordCompensation") {
      kind = "compensation";
      record = {
        ...args[0],
        id: id("comp"),
        status: "PENDING",
        createdAt: iso(),
        updatedAt: iso()
      };
    } else if (method === "updateCompensationStatus") {
      kind = "compensation";
      record = await readOne(env, kind, String(args[0]?.compensationId));
      if (!record) return fail(404, "NOT_FOUND", "Compensation not found");
      Object.assign(record, args[0], { updatedAt: iso(), settledBy: actor.id });
    } else {
      kind = "recommendation";
      record = await readOne(env, kind, String(args[0]));
      if (!record) return fail(404, "NOT_FOUND", "Recommendation not found");
      record.status = args[1] === "APPLY" ? "APPLIED" : "DISMISSED";
      record.reviewedAt = iso();
      record.reviewedBy = actor.id;
      record.decisionNotes = String(args[2] ?? "").slice(0, 1e3);
    }
    const owner = record.userId ?? null;
    await env.DB.batch([
      put(env, kind, record, owner, record.status ?? null),
      audit(env, actor, kind.toUpperCase(), record.id, method.toUpperCase())
    ]);
    return ok(
      record,
      method === "createIncident" || method === "issueStrike" || method === "recordCompensation" ? 201 : 200
    );
  }
  if (service === "audit" && ["startAudit", "recordCounts", "reconcileItem", "completeAudit"].includes(method)) {
    let auditRecord;
    if (method === "startAudit") {
      const input = args[0] ?? {};
      const rows = await env.DB.prepare("SELECT id,data FROM inventory").all();
      const items = (rows.results ?? []).map((r) => {
        const item = decode(r.data);
        return {
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          equipmentClass: item.equipmentClass,
          expectedSnapshotQuantity: item.availableQuantity + item.allocatedQuantity + item.damagedQuantity + item.maintenanceQuantity,
          movementsSinceSnapshot: 0,
          adjustedExpectedQuantity: item.availableQuantity + item.allocatedQuantity + item.damagedQuantity + item.maintenanceQuantity,
          status: "PENDING_COUNT"
        };
      });
      auditRecord = {
        id: id("audit"),
        title: String(input.title ?? "Inventory audit").slice(0, 160),
        startedAt: iso(),
        startedBy: actor.id,
        startedByName: actor.name,
        status: "IN_PROGRESS",
        snapshotAt: iso(),
        items,
        notes: String(input.notes ?? "").slice(0, 1e3)
      };
    } else {
      const input = args[0];
      auditRecord = await readOne(env, "inventory_audit", String(input.auditId));
      if (!auditRecord) return fail(404, "NOT_FOUND", "Audit not found");
      if (method === "recordCounts") {
        for (const count of input.counts ?? []) {
          const item = auditRecord.items.find((i) => i.itemId === count.itemId);
          if (item) {
            item.physicalCount = count.physicalCount;
            item.countedAt = iso();
            item.discrepancy = count.physicalCount - item.adjustedExpectedQuantity;
            item.status = item.discrepancy === 0 ? "MATCHED" : "DISCREPANCY";
          }
        }
      } else if (method === "reconcileItem") {
        const item = auditRecord.items.find((i) => i.itemId === input.itemId);
        if (!item) return fail(404, "NOT_FOUND", "Audit item not found");
        item.status = "RECONCILED";
        item.resolutionNotes = String(input.resolutionNotes ?? "").slice(0, 1e3);
      } else {
        auditRecord.status = "RECONCILED";
        auditRecord.completedAt = iso();
        auditRecord.completedBy = actor.id;
      }
    }
    auditRecord.updatedAt = iso();
    await env.DB.batch([
      put(env, "inventory_audit", auditRecord, null, auditRecord.status),
      audit(env, actor, "AUDIT", auditRecord.id, "AUDIT_" + method.toUpperCase())
    ]);
    return ok(auditRecord);
  }
  if (service === "user" && method === "createUser")
    return createUser(env, actor, args[0]);
  if (service === "user" && method === "removeUser")
    return removeUser(env, actor, args[0]);
  if (service === "user" && method === "resetPassword")
    return resetUserPassword(env, actor, args[0]);
  if (service === "user" && ["processUser", "updateClearance", "updateRole", "updateStatus"].includes(method))
    return updateUser(env, actor, method, args[0]);
  if (service === "allocation" && method === "checkAndExpireAllocations")
    return ok(await expireDue(env, actor));
  if (service === "auditLog" && method === "logEvent") {
    const input = args[0] ?? {};
    const event = {
      ...input,
      id: id("audit"),
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      createdAt: iso()
    };
    await env.DB.batch([
      put(env, "audit_event", event, actor.id, event.action),
      audit(env, actor, "AUDIT", event.id, "AUDIT_EVENT_RECORDED")
    ]);
    return ok(event, 201);
  }
  return null;
}
async function updateUser(env, actor, method, input) {
  const targetId = String(input?.userId ?? "");
  if (!targetId) return fail(400, "VALIDATION", "Member ID is required");
  const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(targetId).first();
  if (!row) return fail(404, "NOT_FOUND", "Member not found");
  let values = {};
  if (method === "processUser") {
    const affiliation = input.verifiedAffiliation ?? input.affiliation;
    if (!["IEEE", "AEROBOTIX", "EXTERNAL", "EUROBOT", "RAS_BOARD"].includes(affiliation))
      return fail(400, "VALIDATION", "Affiliation is invalid");
    values = {
      affiliation,
      claimed_affiliation: row.claimed_affiliation,
      affiliation_verified: 1,
      clearance: affiliation === "IEEE" ? "III" : affiliation === "AEROBOTIX" ? "II" : "I"
    };
  }
  if (method === "updateClearance") {
    if (!["I", "II", "III", "IV", "V", "VI"].includes(input.newClearance))
      return fail(400, "VALIDATION", "Clearance is invalid");
    values = { clearance: input.newClearance, clearance_source: input.source };
  }
  if (method === "updateRole") {
    if (!["MEMBER", "OPERATOR", "SUPERADMIN"].includes(input.newRole))
      return fail(400, "VALIDATION", "Role is invalid");
    if (input.newRole === "SUPERADMIN" && actor.id === targetId)
      return fail(409, "CONFLICT", "Use another superadmin to change this account");
    values = { role: input.newRole };
  }
  if (method === "updateStatus") {
    if (!["ACTIVE", "RESTRICTED", "BANNED", "BLACKLISTED", "PENDING"].includes(input.status))
      return fail(400, "VALIDATION", "Status is invalid");
    if (actor.id === targetId && input.status !== "ACTIVE")
      return fail(409, "CONFLICT", "You cannot suspend your own account");
    values = { status: input.status };
  }
  const statements = [
    env.DB.prepare(
      `UPDATE app_users SET ${Object.keys(values).map((key) => `${key}=?`).join(",")},updated_at=? WHERE id=?`
    ).bind(...Object.values(values), stamp(), targetId)
  ];
  if (method === "updateRole" && values.role === "MEMBER" || method === "updateStatus" && values.status !== "ACTIVE")
    statements.push(
      env.DB.prepare(
        "UPDATE staff_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL"
      ).bind(stamp(), targetId)
    );
  statements.push(
    audit(env, actor, "USER", targetId, "USER_" + method.toUpperCase(), {
      fields: Object.keys(values)
    })
  );
  await env.DB.batch(statements);
  const updated = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(targetId).first();
  return ok(publicProfile(updated));
}
async function createUser(env, actor, input) {
  if (actor.role !== "SUPERADMIN" && actor.role !== "OPERATOR")
    return fail(403, "FORBIDDEN", "Staff access is required to add people");
  if (!input || typeof input.email !== "string" || !input.email.includes("@"))
    return fail(400, "VALIDATION", "Valid email address is required");
  if (typeof input.name !== "string" || input.name.trim().length < 2)
    return fail(400, "VALIDATION", "Valid name is required");
  const email = input.email.trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM app_users WHERE email=? COLLATE NOCASE").bind(email).first();
  if (existing) return fail(409, "CONFLICT", "A user with this email already exists");
  const targetRole = input.role || "MEMBER";
  if (!["MEMBER", "OPERATOR", "SUPERADMIN"].includes(targetRole))
    return fail(400, "VALIDATION", "Invalid role specified");
  if (targetRole === "SUPERADMIN" && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Only Superadmins can create other Superadmins");
  const affiliation = input.affiliation || (targetRole === "MEMBER" ? "IEEE" : "RAS_BOARD");
  const clearance = input.clearance || (targetRole === "SUPERADMIN" ? "VI" : targetRole === "OPERATOR" ? "V" : affiliation === "IEEE" ? "III" : affiliation === "AEROBOTIX" ? "II" : "I");
  const phone = input.phone ? String(input.phone).trim() : "";
  const newId = crypto.randomUUID();
  const timestamp = stamp();
  const userData = input.password ? { password: String(input.password).trim() } : {};
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id, name, email, emailVerified, createdAt, updatedAt) VALUES(?,?,?,1,?,?)"
    ).bind(newId, input.name.trim(), email, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO app_users(id, email, name, phone, role, clearance, clearance_source, affiliation, claimed_affiliation, affiliation_verified, status, data, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,'ACTIVE',?,?,?)`
    ).bind(
      newId,
      email,
      input.name.trim(),
      phone,
      targetRole,
      clearance,
      targetRole === "SUPERADMIN" ? "SUPERADMIN_ROLE" : targetRole === "OPERATOR" ? "OPERATOR_ROLE" : "AFFILIATION",
      affiliation,
      affiliation,
      JSON.stringify(userData),
      timestamp,
      timestamp
    ),
    audit(env, actor, "USER", newId, "USER_CREATED", { email, role: targetRole, clearance })
  ]);
  const createdRow = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(newId).first();
  return ok(createdRow ? publicProfile(createdRow) : null, 201);
}
async function removeUser(env, actor, input) {
  const targetId = typeof input === "string" ? input : String(input?.userId ?? "");
  if (!targetId) return fail(400, "VALIDATION", "User ID is required");
  if (targetId === actor.id) return fail(400, "VALIDATION", "You cannot remove your own account");
  const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(targetId).first();
  if (!row) return fail(404, "NOT_FOUND", "User not found");
  if (row.role === "SUPERADMIN" && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Only Superadmins can remove another Superadmin");
  const activeLoans = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='loan' AND owner_id=? AND status IN ('ACTIVE', 'OVERDUE')"
  ).bind(targetId).first();
  if (activeLoans && activeLoans.count > 0) {
    return fail(
      409,
      "CONFLICT",
      `Cannot remove ${row.name}: user currently possesses ${activeLoans.count} active borrowed equipment item(s). Return all items first.`
    );
  }
  const activeRequests = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM requests WHERE user_id=? AND status IN ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED')"
  ).bind(targetId).first();
  if (activeRequests && activeRequests.count > 0) {
    return fail(
      409,
      "CONFLICT",
      `Cannot remove ${row.name}: user has active or pending borrow requests. Review, reject, or complete them first.`
    );
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_users WHERE id=?").bind(targetId),
    env.DB.prepare("DELETE FROM user WHERE id=?").bind(targetId),
    env.DB.prepare("DELETE FROM session WHERE userId=?").bind(targetId),
    env.DB.prepare("DELETE FROM staff_sessions WHERE user_id=?").bind(targetId),
    env.DB.prepare("DELETE FROM record_store WHERE kind='notification' AND owner_id=?").bind(targetId),
    audit(env, actor, "USER", targetId, "USER_REMOVED", { email: row.email, name: row.name, role: row.role })
  ]);
  return ok({ success: true });
}
function generateStaffPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  const part1 = Array.from(arr.slice(0, 4), (b) => chars[b % chars.length]).join("");
  const part2 = Array.from(arr.slice(4, 8), (b) => chars[b % chars.length]).join("");
  const part3 = Array.from(arr.slice(8, 12), (b) => chars[b % chars.length]).join("");
  return `ras-${part1}-${part2}-${part3}`;
}
async function resetUserPassword(env, actor, input) {
  const targetId = typeof input === "string" ? input : String(input?.userId ?? "");
  if (!targetId) return fail(400, "VALIDATION", "User ID is required");
  if (actor.role !== "SUPERADMIN" && actor.id !== targetId)
    return fail(403, "FORBIDDEN", "Only Superadmins can reset passwords for other accounts");
  const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(targetId).first();
  if (!row) return fail(404, "NOT_FOUND", "User not found");
  const newPassword = generateStaffPassword();
  const currentData = decode(row.data) ?? {};
  currentData.password = newPassword;
  await env.DB.batch([
    env.DB.prepare("UPDATE app_users SET data=?, updated_at=? WHERE id=?").bind(
      JSON.stringify(currentData),
      stamp(),
      targetId
    ),
    env.DB.prepare("UPDATE staff_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(
      stamp(),
      targetId
    ),
    audit(env, actor, "USER", targetId, "USER_PASSWORD_RESET", {
      email: row.email,
      name: row.name,
      role: row.role
    })
  ]);
  return ok({ success: true, newPassword });
}
function publicProfile(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? void 0,
    role: row.role,
    clearance: row.clearance,
    clearanceSource: row.clearance_source ?? void 0,
    affiliation: row.affiliation,
    claimedAffiliation: row.claimed_affiliation ?? void 0,
    verifiedAffiliation: row.affiliation_verified ? row.affiliation : void 0,
    isProcessed: row.affiliation_verified === 1,
    status: row.status,
    strikesCount: 0,
    strikes: [],
    joinedDate: iso(row.created_at),
    activeLoansCount: 0,
    totalRequestsCount: 0
  };
}
async function getUsers(env, filter) {
  const rows = await env.DB.prepare(
    "SELECT * FROM app_users ORDER BY created_at DESC LIMIT 1000"
  ).all();
  return ok(
    (rows.results ?? []).map(publicProfile).filter(
      (u) => (!filter?.search || `${u.name} ${u.email}`.toLowerCase().includes(String(filter.search).toLowerCase())) && (!filter?.role || filter.role === "ALL" || u.role === filter.role) && (!filter?.clearance || filter.clearance === "ALL" || u.clearance === filter.clearance) && (!filter?.status || filter.status === "ALL" || u.status === filter.status) && (!filter?.unprocessedOnly || !u.isProcessed)
    )
  );
}
async function insights(env) {
  const [inventoryRows, requestCount, loans, projects, incidents, recommendations] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) AS items,COALESCE(SUM(total_quantity),0) total,COALESCE(SUM(available_quantity),0) available,COALESCE(SUM(allocated_quantity),0) allocated FROM inventory"
    ).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM requests").first(),
    env.DB.prepare("SELECT data,status FROM record_store WHERE kind='loan'").all(),
    env.DB.prepare("SELECT COUNT(*) count FROM record_store WHERE kind='project'").first(),
    env.DB.prepare(
      "SELECT COUNT(*) count FROM record_store WHERE kind='incident' AND status='OPEN'"
    ).first(),
    env.DB.prepare(
      "SELECT COUNT(*) count FROM record_store WHERE kind='recommendation' AND status='PENDING_REVIEW'"
    ).first()
  ]);
  const loanList = loans.results ?? [];
  return {
    inventory: {
      totalDistinctItems: inventoryRows?.items ?? 0,
      totalUnits: inventoryRows?.total ?? 0,
      availableUnits: inventoryRows?.available ?? 0,
      allocatedUnits: inventoryRows?.allocated ?? 0,
      borrowedUnits: 0,
      damagedUnits: 0,
      maintenanceUnits: 0,
      lostUnits: 0
    },
    borrowing: {
      totalRequestsCount: requestCount?.count ?? 0,
      requestsThisMonth: 0,
      approvalRatePercent: 0,
      partialApprovalRatePercent: 0,
      activeLoansCount: loanList.filter((r) => r.status === "ACTIVE" || r.status === "OVERDUE").length,
      averageDurationDays: null,
      overdueLoansCount: loanList.filter((r) => r.status === "OVERDUE").length,
      overdueRatePercent: 0
    },
    equipment: { topBorrowedItems: [], frequentlyUnavailableItems: [], mostDamagedItems: [] },
    projects: {
      projectsCount: projects?.count ?? 0,
      equipmentByProject: [],
      requestsByProject: []
    },
    discipline: {
      activeStrikesByLevel: {},
      pendingRecommendationsCount: recommendations?.count ?? 0,
      openIncidentsCount: incidents?.count ?? 0,
      totalCompensationDue: 0
    }
  };
}
async function exportCsv(env, actor, dataset) {
  const allowed = {
    INVENTORY: "inventory",
    ACTIVE_LOANS: "loan",
    OVERDUE_LOANS: "loan",
    REQUESTS: "request",
    PROJECTS: "project",
    STOCK_MOVEMENTS: "inventory_event",
    AUDITS: "inventory_audit",
    STRIKES: "strike",
    INCIDENTS: "incident",
    COMPENSATIONS: "compensation",
    AUDIT_LOG: "audit_event"
  };
  if (!allowed[dataset]) return fail(400, "VALIDATION", "Export dataset is invalid");
  const records = dataset === "INVENTORY" ? (await env.DB.prepare("SELECT data FROM inventory").all()).results?.map(
    (r) => decode(r.data)
  ) ?? [] : await readMany(env, allowed[dataset]);
  const rows = records.filter(
    (record) => dataset !== "OVERDUE_LOANS" || record.status === "OVERDUE"
  );
  const columns = rows.length ? Object.keys(rows[0]) : ["id"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    columns.map(quote).join(","),
    ...rows.map(
      (row) => columns.map(
        (column) => quote(typeof row[column] === "object" ? JSON.stringify(row[column]) : row[column])
      ).join(",")
    )
  ].join("\r\n");
  const time = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  await audit(env, actor, "EXPORT", "export", `EXPORT_${dataset}`, { rowCount: rows.length }).run();
  return ok({
    filename: `${dataset.toLowerCase()}-${time}.csv`,
    csvContent: csv,
    rowCount: rows.length
  });
}

// src/worker/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

// src/worker/email.ts
async function sendEmail(env, to, subject, htmlContent) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    console.warn("Email service not configured; skipping email to:", to);
    return;
  }
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME ?? "IEEE RAS INSAT Logistics"
      },
      to: [{ email: to }],
      subject,
      htmlContent
    })
  });
  if (!response.ok) throw new Error("Email delivery failed");
}
function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}

// src/worker/database.ts
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// src/worker/schema.ts
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
var authUsers = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [uniqueIndex("user_email").on(table.email)]
);
var authSessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" })
  },
  (table) => [
    uniqueIndex("session_token").on(table.token),
    index("session_user_id").on(table.userId)
  ]
);
var authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull()
  },
  (table) => [index("account_user_id").on(table.userId)]
);
var authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
  },
  (table) => [index("verification_identifier").on(table.identifier)]
);
var authRateLimits = sqliteTable(
  "rateLimit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("lastRequest").notNull()
  },
  (table) => [uniqueIndex("rate_limit_key").on(table.key)]
);
var appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    role: text("role", { enum: ["MEMBER", "OPERATOR", "SUPERADMIN"] }).notNull().default("MEMBER"),
    clearance: text("clearance").notNull().default("I"),
    clearanceSource: text("clearance_source"),
    affiliation: text("affiliation").notNull().default("EXTERNAL"),
    claimedAffiliation: text("claimed_affiliation"),
    affiliationVerified: integer("affiliation_verified", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("ACTIVE"),
    data: text("data", { mode: "json" }).notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("app_users_email").on(table.email),
    index("app_users_role_status").on(table.role, table.status)
  ]
);
var inventory = sqliteTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    equipmentClass: text("equipment_class").notNull(),
    trackingMode: text("tracking_mode").notNull(),
    totalQuantity: integer("total_quantity").notNull().default(0),
    availableQuantity: integer("available_quantity").notNull().default(0),
    allocatedQuantity: integer("allocated_quantity").notNull().default(0),
    borrowedQuantity: integer("borrowed_quantity").notNull().default(0),
    damagedQuantity: integer("damaged_quantity").notNull().default(0),
    maintenanceQuantity: integer("maintenance_quantity").notNull().default(0),
    lostQuantity: integer("lost_quantity").notNull().default(0),
    borrowerVisible: integer("borrower_visible", { mode: "boolean" }).notNull().default(false),
    data: text("data", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("inventory_class_visibility").on(table.equipmentClass, table.borrowerVisible),
    check(
      "inventory_stock_conservation",
      sql`${table.totalQuantity} = ${table.availableQuantity} + ${table.allocatedQuantity} + ${table.borrowedQuantity} + ${table.damagedQuantity} + ${table.maintenanceQuantity} + ${table.lostQuantity}`
    ),
    check("inventory_timestamp_nonnegative", sql`${table.updatedAt} >= 0`)
  ]
);
var inventoryAssets = sqliteTable(
  "inventory_assets",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => inventory.id, { onDelete: "cascade" }),
    serialNumber: text("serial_number").notNull(),
    state: text("state").notNull(),
    data: text("data", { mode: "json" }).notNull()
  },
  (table) => [
    uniqueIndex("inventory_asset_serial").on(table.serialNumber),
    index("asset_item_state").on(table.itemId, table.state),
    check(
      "asset_state_valid",
      sql`${table.state} IN ('AVAILABLE','ALLOCATED','BORROWED','DAMAGED','MAINTENANCE','LOST')`
    )
  ]
);
var requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    data: text("data", { mode: "json" }).notNull()
  },
  (table) => [
    index("requests_owner_created").on(table.userId, table.createdAt),
    index("requests_status").on(table.status),
    check("request_no_invalid_sentinel", sql`${table.status} <> 'INVALID'`)
  ]
);
var requestLines = sqliteTable(
  "request_lines",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().references(() => requests.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => inventory.id),
    equipmentClass: text("equipment_class").notNull(),
    quantity: integer("quantity").notNull(),
    data: text("data", { mode: "json" }).notNull()
  },
  (table) => [index("request_lines_item").on(table.itemId)]
);
var recordStore = sqliteTable(
  "record_store",
  {
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    ownerId: text("owner_id"),
    status: text("status"),
    expiresAt: integer("expires_at"),
    data: text("data", { mode: "json" }).notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("record_owner_kind").on(table.kind, table.ownerId),
    index("record_status_kind").on(table.kind, table.status),
    index("record_expiry").on(table.kind, table.expiresAt),
    check("record_timestamp_nonnegative", sql`${table.updatedAt} >= 0`)
  ]
);
var staffChallenges = sqliteTable(
  "staff_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("staff_challenge_expiry").on(table.userId, table.expiresAt)]
);
var staffSessions = sqliteTable("staff_sessions", {
  userId: text("user_id").primaryKey().references(() => appUsers.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  freshUntil: integer("fresh_until").notNull(),
  revokedAt: integer("revoked_at")
});
var idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    actorId: text("actor_id").notNull(),
    response: text("response", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idempotency_created").on(table.createdAt)]
);
var auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
    data: text("data", { mode: "json" }).notNull()
  },
  (table) => [
    index("audit_entity").on(table.entityType, table.entityId, table.createdAt),
    index("audit_actor").on(table.actorUserId, table.createdAt)
  ]
);
var rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull()
});
var registrationIntents = sqliteTable("registration_intents", {
  email: text("email").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  claimedAffiliation: text("claimed_affiliation").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull()
});

// src/worker/database.ts
var authSchema = {
  user: authUsers,
  session: authSessions,
  account: authAccounts,
  verification: authVerifications,
  rateLimit: authRateLimits
};
function createAuthDatabase(client) {
  return drizzle(client, { schema: authSchema });
}
var LibSqlPreparedStatement = class {
  constructor(client, sql2) {
    this.client = client;
    this.sql = sql2;
  }
  args = [];
  bind(...values) {
    if (values.some((value) => value === void 0))
      throw new TypeError("SQL arguments cannot be undefined");
    this.args = values;
    return this;
  }
  async first() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return result.rows[0] ?? null;
  }
  async all() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return toD1Result(result);
  }
  async run() {
    return toD1Result(
      await this.client.execute({ sql: this.sql, args: this.args })
    );
  }
  asLibSqlStatement() {
    return { sql: this.sql, args: this.args };
  }
};
function toD1Result(result) {
  return {
    success: true,
    results: result.rows,
    meta: { changes: result.rowsAffected, last_row_id: result.lastInsertRowid }
  };
}
var LibSqlD1Database = class {
  constructor(client) {
    this.client = client;
  }
  prepare(sql2) {
    return new LibSqlPreparedStatement(this.client, sql2);
  }
  async batch(statements) {
    if (statements.length === 0) return [];
    const queries = statements.map((statement) => {
      if (!(statement instanceof LibSqlPreparedStatement))
        throw new TypeError("Batch statement belongs to another database");
      return statement.asLibSqlStatement();
    });
    const results = await this.client.batch(queries, "write");
    return results.map(toD1Result);
  }
};
function createLibSqlClient(url, authToken) {
  return createClient({ url, authToken });
}

// src/worker/auth.ts
function trustedAuthOrigin(env, requestUrl) {
  const requestOrigin = new URL(requestUrl);
  const allowedHosts = new Set([env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean));
  const isLocal = ["localhost", "127.0.0.1"].includes(requestOrigin.hostname);
  if (env.APP_ORIGIN && requestOrigin.origin !== new URL(env.APP_ORIGIN).origin && !isLocal)
    throw new Error("Request host is not the configured application address");
  if (!env.APP_ORIGIN && !isLocal && !allowedHosts.has(requestOrigin.host))
    throw new Error("Request host is not a Vercel deployment address");
  const origin = env.APP_ORIGIN && !isLocal ? new URL(env.APP_ORIGIN) : new URL(requestOrigin.origin);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
    throw new Error("APP_ORIGIN must be an origin without a path");
  if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1")
    throw new Error("APP_ORIGIN must use HTTPS");
  return origin.origin;
}
function createAuth(env, origin = env.APP_ORIGIN ?? "http://localhost:8787") {
  return betterAuth({
    appName: "IEEE RAS INSAT Logistics",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(env.AUTH_DATABASE, { provider: "sqlite", schema: authSchema }),
    trustedOrigins: [origin],
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/"
      }
    },
    session: {
      expiresIn: 390 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false }
    },
    rateLimit: { enabled: true, window: 60, max: 10, storage: "database" },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        storeToken: "hashed",
        disableSignUp: true,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail(
            env,
            email,
            "Your IEEE RAS INSAT Logistics sign-in link",
            `<p>Use this single-use link within 10 minutes to sign in:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>If you did not request this email, you can ignore it.</p>`
          );
        }
      })
    ]
  });
}

// src/worker/identity.ts
async function resolveIdentity(c) {
  try {
    const auth = createAuth(c.env, trustedAuthOrigin(c.env, c.req.url));
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      const user = await c.env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(session.user.id).first();
      if (user) return user;
    }
  } catch {
  }
  const cookie = c.req.header("Cookie") ?? "";
  const tokenMatch = cookie.match(/(?:better-auth\.session_token|ras_staff_session)=([^;]+)/);
  const token = tokenMatch?.[1]?.trim() || c.req.header("x-device-key");
  if (token) {
    const sessionRow = await c.env.DB.prepare(
      "SELECT userId FROM session WHERE token=? AND expiresAt > ?"
    ).bind(token, Date.now()).first();
    if (sessionRow?.userId) {
      const user = await c.env.DB.prepare("SELECT * FROM app_users WHERE id=?").bind(sessionRow.userId).first();
      if (user) return user;
    }
  }
  return null;
}
async function requireMember(c) {
  const user = await resolveIdentity(c);
  if (!user || user.status !== "ACTIVE" || user.role !== "MEMBER") return null;
  return user;
}
async function requireBoard(c, fresh = false) {
  const user = await resolveIdentity(c);
  if (!user || user.status !== "ACTIVE" || !["OPERATOR", "SUPERADMIN"].includes(user.role))
    return null;
  const challenge = await c.env.DB.prepare(
    "SELECT expires_at,fresh_until,revoked_at FROM staff_sessions WHERE user_id=?"
  ).bind(user.id).first();
  if (!challenge || challenge.revoked_at || challenge.expires_at <= Date.now()) return null;
  if (fresh && challenge.fresh_until <= Date.now()) return null;
  return user;
}

// src/worker/security.ts
function jsonError(c, status, code, message) {
  return c.json({ error: { code, message } }, status);
}
var sameOrigin = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (!origin) return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
  try {
    const originUrl = new URL(origin);
    const host = c.req.header("x-forwarded-host") || c.req.header("host") || new URL(c.req.url).host;
    const hostWithoutPort = host.split(":")[0];
    if (originUrl.hostname !== hostWithoutPort && origin !== new URL(c.req.url).origin) {
      return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
    }
  } catch {
    return jsonError(c, 403, "ORIGIN_REJECTED", "Request origin is not allowed");
  }
  return next();
};
async function verifyTurnstile(env, token, ip, origin) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.hostname === new URL(origin).hostname;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function rateLimit(db, key, max, windowSeconds) {
  const now2 = Math.floor(Date.now() / 1e3);
  const keyHash = await digest(key);
  const windowStart = Math.floor(now2 / windowSeconds) * windowSeconds;
  const row = await db.prepare(
    `INSERT INTO rate_limit_buckets(key_hash,window_start,count)
    VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET
    count=CASE WHEN window_start=? THEN count+1 ELSE 1 END,
    window_start=? WHERE window_start<>? OR count<? RETURNING count`
  ).bind(keyHash, windowStart, windowStart, windowStart, windowStart, max).first();
  return row !== null && row.count <= max;
}

// src/worker/index.ts
var app = new Hono();
var now = () => Date.now();
var iso2 = (time = now()) => new Date(time).toISOString();
var uuid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
var parseJson = (value) => JSON.parse(value);
app.use("*", requestId());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      frameSrc: ["https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    },
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    permissionsPolicy: { camera: false, microphone: false, geolocation: false }
  })
);
app.use("/api/*", sameOrigin);
app.use("/api/*", async (c, next) => {
  const key = c.req.header("CF-Connecting-IP") ?? "unknown";
  const decision = await c.env.API_RATE_LIMITER.limit({ key });
  if (!decision.success)
    return jsonError(c, 429, "RATE_LIMITED", "Too many requests; slow down and try again");
  c.header("Cache-Control", "no-store");
  c.header("X-Request-Id", c.get("requestId"));
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => jsonError(c, 413, "BODY_TOO_LARGE", "Request body is too large")
  })
);
app.use("/api/v1/catalog*", async (c, next) => {
  await expireAllocations(c.env);
  await next();
});
app.use("/api/v1/board/inventory", async (c, next) => {
  await expireAllocations(c.env);
  await next();
});
app.onError((error, c) => {
  const requestIdValue = c.get("requestId");
  console.error("request_failed", { requestId: requestIdValue, type: error.name });
  return jsonError(c, 500, "INTERNAL", "The request could not be completed");
});
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/v1/config", (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY }));
app.get("/api/cron/maintenance", async (c) => {
  const expected = c.env.CRON_SECRET;
  const received = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected)
    return jsonError(c, 503, "MAINTENANCE_DISABLED", "Scheduled maintenance is not configured");
  if (!timingSafeEqual(received, expected))
    return jsonError(c, 401, "UNAUTHENTICATED", "Scheduled maintenance authorization failed");
  await expireAllocations(c.env);
  await cleanExpiredSecurityData(c.env);
  return c.json({ ok: true });
});
app.all("/api/auth/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (c.req.method === "POST" && pathname.endsWith("/sign-in/magic-link")) {
    const workerLimit = await c.env.AUTH_RATE_LIMITER.limit({
      key: c.req.header("CF-Connecting-IP") ?? "unknown"
    });
    if (!workerLimit.success)
      return jsonError(c, 429, "RATE_LIMITED", "Too many sign-in attempts; try again later");
    const body = await c.req.raw.clone().json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "invalid";
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!await rateLimit(c.env.DB, `magic:${email}:${ip}`, 3, 3600))
      return jsonError(
        c,
        429,
        "RATE_LIMITED",
        "Please wait before requesting another sign-in link"
      );
    if (!await verifyTurnstile(c.env, body.turnstileToken, ip, trustedAuthOrigin(c.env, c.req.url)))
      return jsonError(c, 403, "CHALLENGE_FAILED", "Complete the security check and try again");
    const callback = body.callbackURL;
    if (callback) {
      try {
        if (new URL(callback).origin !== trustedAuthOrigin(c.env, c.req.url))
          return jsonError(c, 400, "VALIDATION", "Invalid sign-in destination");
      } catch {
        return jsonError(c, 400, "VALIDATION", "Invalid sign-in destination");
      }
    }
    const allowed = await c.env.DB.prepare(
      `SELECT user.id FROM user INNER JOIN app_users ON app_users.id=user.id
      WHERE user.email=? COLLATE NOCASE AND app_users.role IN ('OPERATOR','SUPERADMIN') AND app_users.status='ACTIVE'`
    ).bind(email).first();
    if (!allowed) return c.json({ status: true }, 200);
  }
  return createAuth(c.env, trustedAuthOrigin(c.env, c.req.url)).handler(c.req.raw);
});
app.post("/api/v1/auth/board-login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!await rateLimit(c.env.DB, `board-login:${ip}`, 10, 60)) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many login attempts; please wait a minute");
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return jsonError(c, 400, "VALIDATION", "Staff email and password are required");
  }
  const email = body.email.trim().toLowerCase();
  const password = body.password.trim();
  const user = await c.env.DB.prepare(
    "SELECT id, name, email, role, clearance, affiliation, status, data FROM app_users WHERE email=? COLLATE NOCASE"
  ).bind(email).first();
  if (!user || !["OPERATOR", "SUPERADMIN"].includes(user.role) || user.status !== "ACTIVE") {
    return jsonError(c, 403, "FORBIDDEN", "Invalid staff credentials or account not active");
  }
  const expectedPassword = c.env.BOARD_STAFF_PASSWORD || "ras-insat-board-2026";
  const userSpecificPassword = parseJson(user.data)?.password;
  const isPasswordValid = userSpecificPassword && timingSafeEqual(password, userSpecificPassword) || timingSafeEqual(password, expectedPassword);
  if (!isPasswordValid) {
    return jsonError(c, 401, "UNAUTHENTICATED", "Invalid staff password");
  }
  const timestamp = now();
  const expiresAt = timestamp + 30 * 24 * 60 * 60 * 1e3;
  const freshUntil = timestamp + 8 * 60 * 60 * 1e3;
  const sessionId = uuid("sess");
  const sessionToken = uuid("tok");
  const deviceKey = body.deviceKey && body.deviceKey.length >= 16 ? body.deviceKey : uuid("dev");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO session(id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      sessionId,
      expiresAt,
      sessionToken,
      timestamp,
      timestamp,
      ip,
      c.req.header("User-Agent") ?? null,
      user.id
    ),
    c.env.DB.prepare(
      "INSERT INTO staff_sessions(user_id, expires_at, fresh_until, revoked_at) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at, fresh_until=excluded.fresh_until, revoked_at=NULL"
    ).bind(user.id, expiresAt, freshUntil),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id, actor_user_id, entity_type, entity_id, action, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      uuid("audit"),
      user.id,
      "AUTH",
      user.id,
      "BOARD_LOGIN_SUCCESS",
      timestamp,
      JSON.stringify({ ip, deviceKey })
    )
  ]);
  const isHttps = c.req.url.startsWith("https:");
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`;
  c.header("Set-Cookie", `better-auth.session_token=${sessionToken}; ${cookieFlags}`, {
    append: true
  });
  c.header("Set-Cookie", `ras_staff_session=${sessionToken}; ${cookieFlags}`, { append: true });
  return c.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clearance: user.clearance,
      affiliation: user.affiliation,
      status: user.status
    },
    deviceKey
  });
});
app.post("/api/v1/auth/borrower", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const rateDecision = await c.env.AUTH_RATE_LIMITER.limit({ key: `borrower-auth:${ip}` });
  if (!rateDecision.success) {
    return jsonError(c, 429, "RATE_LIMITED", "Too many requests; slow down and try again");
  }
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return jsonError(c, 400, "VALIDATION", "A valid email address is required");
  }
  const email = body.email.trim().toLowerCase();
  const name = (body.name || `${body.firstName ?? ""} ${body.lastName ?? ""}`).trim() || "Borrower";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const membership = ["IEEE", "AEROBOTIX", "EXTERNAL"].includes(body.membership ?? "") ? body.membership : "EXTERNAL";
  const existing = await c.env.DB.prepare(
    "SELECT * FROM app_users WHERE email=? COLLATE NOCASE"
  ).bind(email).first();
  const userId = existing?.id ?? `borrower-${await digest(email)}`;
  const clearance = membership === "IEEE" ? "III" : membership === "AEROBOTIX" ? "II" : "I";
  const timestamp = Date.now();
  if (existing) {
    await c.env.DB.prepare(
      "UPDATE app_users SET name=?, phone=?, claimed_affiliation=?, updated_at=? WHERE id=?"
    ).bind(name, phone, membership, timestamp, existing.id).run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO app_users(id, email, name, phone, role, clearance, affiliation, claimed_affiliation, affiliation_verified, status, data, created_at, updated_at) VALUES(?, ?, ?, ?, 'MEMBER', ?, ?, ?, 0, 'ACTIVE', '{}', ?, ?)"
    ).bind(userId, email, name, phone, clearance, membership, membership, timestamp, timestamp).run();
  }
  const user = {
    id: userId,
    email,
    name,
    phone,
    role: "MEMBER",
    clearance,
    affiliation: existing?.affiliation ?? membership,
    claimedAffiliation: membership,
    status: "ACTIVE"
  };
  return c.json({ ok: true, user });
});
app.post("/api/v1/staff/challenge", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const email = actor.email;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!await rateLimit(c.env.DB, `staff-code:${actor.id}:${ip}`, 3, 3600))
    return jsonError(c, 429, "RATE_LIMITED", "Please wait before requesting another code");
  const entropy = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(entropy);
    value = entropy[0];
  } while (value >= Math.floor(4294967296 / 1e6) * 1e6);
  const code = String(value % 1e6).padStart(6, "0");
  const codeHash = await otpHash(c.env, actor.id, code);
  const created = now();
  await c.env.DB.prepare(
    "INSERT INTO staff_challenges(id,user_id,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)"
  ).bind(crypto.randomUUID(), actor.id, codeHash, created + 10 * 6e4, created).run();
  await sendStaffCode(c.env, email, code);
  return c.json(
    { ok: true, message: "A verification code has been sent to your staff email." },
    202
  );
});
app.get("/api/v1/board/session", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const session = await c.env.DB.prepare(
    "SELECT expires_at,fresh_until,revoked_at FROM staff_sessions WHERE user_id=?"
  ).bind(actor.id).first();
  return c.json({
    active: Boolean(session && !session.revoked_at && session.expires_at > now()),
    fresh: Boolean(session && !session.revoked_at && session.fresh_until > now()),
    expiresAt: session?.expires_at ?? null,
    freshUntil: session?.fresh_until ?? null
  });
});
app.post("/api/v1/staff/verify", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor || !["OPERATOR", "SUPERADMIN"].includes(actor.role) || actor.status !== "ACTIVE")
    return jsonError(c, 403, "FORBIDDEN", "Board access is not enabled for this account");
  const body = await c.req.json().catch(() => null);
  if (!body || !/^\d{6}$/.test(body.code ?? ""))
    return jsonError(c, 400, "VALIDATION", "Enter the six-digit code");
  const challenge = await c.env.DB.prepare(
    `SELECT id,code_hash,expires_at,attempts FROM staff_challenges
    WHERE user_id=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(actor.id).first();
  if (!challenge || challenge.expires_at <= now() || challenge.attempts >= 5)
    return jsonError(c, 401, "CHALLENGE_EXPIRED", "Request a new verification code");
  const hash = await otpHash(c.env, actor.id, body.code ?? "");
  if (!timingSafeEqual(hash, challenge.code_hash)) {
    await c.env.DB.prepare(
      "UPDATE staff_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5"
    ).bind(challenge.id).run();
    return jsonError(c, 401, "CHALLENGE_INVALID", "The code is incorrect or expired");
  }
  const timestamp = now();
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE staff_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<5"
    ).bind(timestamp, challenge.id),
    c.env.DB.prepare(
      `INSERT INTO staff_sessions(user_id,expires_at,fresh_until,revoked_at) VALUES(?,?,?,NULL)
      ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at,fresh_until=excluded.fresh_until,revoked_at=NULL`
    ).bind(actor.id, timestamp + 8 * 60 * 6e4, timestamp + 10 * 6e4)
  ]);
  if (!batch[0]?.success) return jsonError(c, 409, "CONFLICT", "The code was already used");
  return c.json({ ok: true, expiresAt: timestamp + 8 * 60 * 6e4 });
});
app.post("/api/v1/staff/revoke", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json().catch(() => ({}));
  if (actor.role !== "SUPERADMIN" || !body.userId)
    return jsonError(c, 403, "FORBIDDEN", "Superadmin access is required");
  await c.env.DB.prepare("UPDATE staff_sessions SET revoked_at=? WHERE user_id=?").bind(now(), body.userId).run();
  return c.json({ ok: true });
});
app.post("/api/v1/board/users/invite", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor || actor.role !== "SUPERADMIN")
    return jsonError(c, 403, "FORBIDDEN", "Fresh superadmin verification is required");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || body.email.length > 254 || !/^\S+@\S+\.\S+$/.test(body.email) || typeof body.name !== "string" || body.name.trim().length < 3 || body.name.length > 120)
    return jsonError(c, 400, "VALIDATION", "Enter the operator name and email");
  const email = body.email.trim().toLowerCase();
  const current = await c.env.DB.prepare(
    "SELECT id,role FROM app_users WHERE email=? COLLATE NOCASE"
  ).bind(email).first();
  if (current) return jsonError(c, 409, "CONFLICT", "An account already exists for this email");
  const id2 = crypto.randomUUID();
  const timestamp = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,0,?,?)"
      ).bind(id2, body.name.trim(), email, timestamp, timestamp),
      c.env.DB.prepare(
        `INSERT INTO app_users(id,email,name,role,clearance,clearance_source,affiliation,claimed_affiliation,affiliation_verified,status,data,created_at,updated_at)
        VALUES(?,?,?,'OPERATOR','V','OPERATOR_ROLE','RAS_BOARD','RAS_BOARD',1,'ACTIVE','{}',?,?)`
      ).bind(id2, email, body.name.trim(), timestamp, timestamp),
      c.env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(
        uuid("audit"),
        actor.id,
        "USER",
        id2,
        "OPERATOR_INVITED",
        timestamp,
        JSON.stringify({ email })
      )
    ]);
    const origin = trustedAuthOrigin(c.env, c.req.url);
    await createAuth(c.env, origin).api.signInMagicLink({
      body: { email, name: body.name.trim(), callbackURL: `${origin}/board` },
      headers: c.req.raw.headers
    });
  } catch {
    return jsonError(
      c,
      503,
      "INVITE_UNAVAILABLE",
      "The operator record was created but the sign-in email could not be sent; ask the operator to request a sign-in link"
    );
  }
  return c.json({ ok: true }, 202);
});
app.get("/api/v1/me", async (c) => {
  const user = await resolveIdentity(c);
  if (!user) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const strikes = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='strike' AND owner_id=? AND status='ACTIVE'"
  ).bind(user.id).first();
  return c.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? void 0,
    role: user.role,
    clearance: user.clearance,
    affiliation: user.affiliation,
    claimedAffiliation: user.claimed_affiliation,
    affiliationVerified: user.affiliation_verified === 1,
    isProcessed: user.affiliation_verified === 1 || user.role !== "MEMBER",
    status: user.status,
    strikesCount: strikes?.count ?? 0
  });
});
app.get("/api/v1/catalog", async (c) => {
  const search = (c.req.query("search") ?? "").trim().slice(0, 100).toLowerCase();
  const category = (c.req.query("category") ?? "").trim().slice(0, 80);
  const rows = await c.env.DB.prepare(
    `SELECT id,name,category,equipment_class,available_quantity,total_quantity,borrower_visible,data
    FROM inventory WHERE borrower_visible=1 ORDER BY name LIMIT 500`
  ).all();
  const items = (rows.results ?? []).filter(
    (row) => row.total_quantity > 0 && row.borrower_visible && (!category || row.category === category) && (!search || row.name.toLowerCase().includes(search) || row.category.toLowerCase().includes(search))
  ).map((row) => ({
    id: row.id,
    name: row.name,
    description: (parseJson(row.data).description ?? "").slice(0, 2e3),
    category: row.category,
    imageUrl: safeImage(parseJson(row.data).imageUrl),
    availability: row.available_quantity > 3 ? "AVAILABLE" : row.available_quantity > 0 ? "LIMITED" : "UNAVAILABLE",
    action: row.available_quantity > 0 ? "REQUEST" : "NONE"
  }));
  const availableOnly = c.req.query("availableOnly") === "true";
  return c.json(
    availableOnly ? items.filter((item) => item.availability !== "UNAVAILABLE") : items
  );
});
app.get("/api/v1/catalog/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id,name,category,equipment_class,available_quantity,total_quantity,borrower_visible,data
    FROM inventory WHERE id=?`
  ).bind(c.req.param("id")).first();
  if (!row || !row.borrower_visible || row.total_quantity < 1)
    return jsonError(c, 404, "NOT_FOUND", "Catalogue item not found");
  const data = parseJson(row.data);
  return c.json({
    id: row.id,
    name: row.name,
    description: String(data.description ?? "").slice(0, 2e3),
    category: row.category,
    imageUrl: safeImage(data.imageUrl),
    ...data.datasheetUrl ? { datasheetUrl: safeImage(data.datasheetUrl) } : {},
    availability: row.available_quantity > 3 ? "AVAILABLE" : row.available_quantity > 0 ? "LIMITED" : "UNAVAILABLE",
    action: ["C", "E"].includes(row.equipment_class) ? row.available_quantity > 0 ? "REQUEST" : "NONE" : "ASK_OPERATOR"
  });
});
app.get("/api/v1/profile", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const [requestCount, activeLoans, strikeRows] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM requests WHERE user_id=?").bind(actor.id).first(),
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM record_store WHERE kind='loan' AND owner_id=? AND status IN ('ACTIVE','OVERDUE')"
    ).bind(actor.id).first(),
    c.env.DB.prepare(
      "SELECT data FROM record_store WHERE kind='strike' AND owner_id=? ORDER BY updated_at DESC LIMIT 100"
    ).bind(actor.id).all()
  ]);
  const strikes = (strikeRows.results ?? []).map((row) => parseJson(row.data));
  return c.json({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    phone: actor.phone ?? "",
    role: actor.role,
    clearance: actor.clearance,
    affiliation: actor.affiliation,
    claimedAffiliation: actor.claimed_affiliation ?? void 0,
    verifiedAffiliation: actor.affiliation_verified ? actor.affiliation : void 0,
    clearanceSource: actor.clearance_source ?? void 0,
    isProcessed: actor.affiliation_verified === 1,
    status: actor.status,
    strikesCount: strikes.filter((s) => s.status === "ACTIVE").length,
    strikes: strikes.map((s) => ({
      id: s.id,
      date: s.issuedAt,
      reason: s.reason,
      severity: s.level >= 4 ? "SUSPENSION" : s.level >= 2 ? "RESTRICTION" : "WARNING",
      resolved: s.status !== "ACTIVE",
      level: s.level
    })),
    joinedDate: iso2(actor.created_at ?? now()),
    activeLoansCount: activeLoans?.count ?? 0,
    totalRequestsCount: requestCount?.count ?? 0
  });
});
app.patch("/api/v1/profile", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const body = await c.req.json().catch(() => null);
  if (!body || body.phone !== void 0 && (typeof body.phone !== "string" || body.phone.length < 8 || body.phone.length > 40))
    return jsonError(c, 400, "VALIDATION", "Contact information is invalid");
  if (body.phone !== void 0)
    await c.env.DB.prepare("UPDATE app_users SET phone=?,updated_at=? WHERE id=?").bind(body.phone.trim(), now(), actor.id).run();
  return c.json({ ...actor, phone: body.phone === void 0 ? actor.phone : body.phone.trim() });
});
app.get("/api/v1/loans", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' AND owner_id=? ORDER BY updated_at DESC LIMIT 200"
  ).bind(actor.id).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/loans/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' AND id=? AND owner_id=?"
  ).bind(c.req.param("id"), actor.id).first();
  return row ? c.json(parseJson(row.data)) : jsonError(c, 404, "NOT_FOUND", "Loan not found");
});
app.get("/api/v1/notifications", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='notification' AND owner_id=? ORDER BY updated_at DESC LIMIT 200"
  ).bind(actor.id).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.patch("/api/v1/notifications/:id", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='notification' AND id=? AND owner_id=?"
  ).bind(c.req.param("id"), actor.id).first();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Notification not found");
  const notification = parseJson(row.data);
  notification.read = true;
  await c.env.DB.prepare(
    "UPDATE record_store SET status='READ',data=?,updated_at=? WHERE kind='notification' AND id=? AND owner_id=?"
  ).bind(JSON.stringify(notification), now(), notification.id, actor.id).run();
  return c.body(null, 204);
});
app.post("/api/v1/notifications/read-all", async (c) => {
  const actor = await resolveIdentity(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='notification' AND owner_id=? AND status<>'READ' LIMIT 500"
  ).bind(actor.id).all();
  await c.env.DB.batch(
    (rows.results ?? []).map((row) => {
      const value = parseJson(row.data);
      value.read = true;
      return c.env.DB.prepare(
        "UPDATE record_store SET status='READ',data=?,updated_at=? WHERE kind='notification' AND id=? AND owner_id=?"
      ).bind(JSON.stringify(value), now(), row.id, actor.id);
    })
  );
  return c.body(null, 204);
});
app.get("/api/v1/projects", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='project' AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 200"
  ).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/projects/mine", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='project' AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 200"
  ).all();
  return c.json(
    (rows.results ?? []).map((row) => parseJson(row.data)).filter((project) => Array.isArray(project.memberIds) && project.memberIds.includes(actor.id))
  );
});
app.get("/api/v1/requests", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM requests WHERE user_id=? ORDER BY created_at DESC LIMIT 200"
  ).bind(actor.id).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/requests/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=? AND user_id=?").bind(c.req.param("id"), actor.id).first();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Request not found");
  return c.json(parseJson(row.data));
});
app.post("/api/v1/requests", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const abuse = await c.env.AUTH_RATE_LIMITER.limit({ key: `borrow-request:${ip}` });
  if (!abuse.success)
    return jsonError(
      c,
      429,
      "RATE_LIMITED",
      "Too many requests from this connection; try again later"
    );
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128)
    return jsonError(c, 400, "VALIDATION", "A valid idempotency key is required");
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 40 || new Set(body.items.map((item) => item?.itemId)).size !== body.items.length || body.items.some(
    (item) => !item || typeof item.itemId !== "string" || item.itemId.length > 100 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
  ) || typeof body.contactEmail !== "string" || body.contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail.trim()) || typeof body.expectedReturnDate !== "string" || !Number.isFinite(Date.parse(body.expectedReturnDate)) || body.note !== void 0 && (typeof body.note !== "string" || body.note.length > 2e3))
    return jsonError(c, 400, "VALIDATION", "The request details are invalid");
  const email = body.contactEmail.trim().toLowerCase();
  const emailLimit = await rateLimit(c.env.DB, `borrower-request:${email}`, 5, 3600);
  if (!emailLimit)
    return jsonError(
      c,
      429,
      "RATE_LIMITED",
      "Too many requests for this contact email; try again later"
    );
  const existing = await c.env.DB.prepare(
    "SELECT id,name,clearance FROM app_users WHERE email=? COLLATE NOCASE"
  ).bind(email).first();
  const borrowerId = existing?.id ?? `borrower-${await digest(email)}`;
  const borrowerName = body.borrowerName?.trim() || existing?.name || "Unverified borrower";
  const key = await digest(`${borrowerId}:${idempotencyKey}`);
  const replay = await c.env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  ).bind(key, borrowerId).first();
  if (replay) return c.json(parseJson(replay.response));
  const requestedItems = await Promise.all(
    body.items.map(async (line) => {
      const item = await c.env.DB.prepare(
        "SELECT id,name,category,equipment_class,available_quantity,borrower_visible FROM inventory WHERE id=?"
      ).bind(line.itemId).first();
      if (!item || !item.borrower_visible || item.available_quantity < 1)
        throw new Error("INELIGIBLE_ITEM");
      const clearanceRank = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
      const reqRank = { A: 1, B: 1, C: 2, D: 3, E: 3, F: 3, G: 4 };
      const requiredClearance = { A: "I", B: "I", C: "II", D: "III", E: "III", F: "III", G: "IV" }[item.equipment_class] ?? "I";
      const userCl = existing?.clearance ?? "I";
      const hasClearanceMismatch = (clearanceRank[userCl] ?? 1) < (reqRank[item.equipment_class] ?? 1);
      const isRestricted = hasClearanceMismatch || !["C", "E"].includes(item.equipment_class);
      const flagReason = hasClearanceMismatch ? `Level restriction: Requires Clearance ${requiredClearance} (Member has ${userCl})` : !["C", "E"].includes(item.equipment_class) ? `Class restriction: Class ${item.equipment_class} requires manual board approval` : void 0;
      return {
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        equipmentClass: item.equipment_class,
        requestedQuantity: line.quantity,
        approvedQuantity: 0,
        handedOverQuantity: 0,
        returnedQuantity: 0,
        damagedQuantity: 0,
        lostQuantity: 0,
        status: "PENDING",
        flagged: isRestricted,
        ...flagReason ? { flagReason } : {}
      };
    })
  ).catch(() => null);
  if (!requestedItems)
    return jsonError(
      c,
      400,
      "INELIGIBLE_ITEM",
      "One or more requested items are currently unavailable or not in catalogue"
    );
  const id2 = uuid("REQ");
  const createdAt = iso2();
  const request = {
    id: id2,
    userId: borrowerId,
    userName: borrowerName,
    userEmail: email,
    contactEmailVerified: false,
    userClearance: "I",
    ...body.note?.trim() ? { note: body.note.trim() } : {},
    expectedReturnDate: body.expectedReturnDate,
    decisionStatus: "PENDING",
    handoverStatus: "WAITING",
    lifecycleStatus: "ACTIVE",
    status: "PENDING",
    flagged: requestedItems.some((line) => line.flagged),
    ...requestedItems.some((line) => line.flagged) ? { flagReason: "One or more requested items require higher clearance" } : {},
    items: requestedItems.map((line, index2) => ({ ...line, id: `${id2}-line-${index2 + 1}` })),
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        status: "PENDING",
        timestamp: createdAt,
        description: requestedItems.some((line) => line.flagged) ? "Request sent with Level restriction flag. Waiting for logistics review." : "Request sent. Waiting for logistics review. Contact email and borrower identity are unverified.",
        actor: borrowerName
      }
    ]
  };
  const affiliation = ["IEEE", "AEROBOTIX", "EXTERNAL"].includes(body.borrowerAffiliation ?? "") ? body.borrowerAffiliation : "EXTERNAL";
  const phone = body.borrowerPhone?.trim() || "";
  const clearance = affiliation === "IEEE" ? "III" : affiliation === "AEROBOTIX" ? "II" : "I";
  const statements = [
    ...existing ? [
      c.env.DB.prepare(
        "UPDATE app_users SET name=COALESCE(NULLIF(?,''),name), phone=COALESCE(NULLIF(?,''),phone), claimed_affiliation=COALESCE(NULLIF(?,''),claimed_affiliation), updated_at=? WHERE id=?"
      ).bind(
        body.borrowerName?.trim() || "",
        phone,
        affiliation,
        Date.parse(createdAt),
        existing.id
      )
    ] : [
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO app_users(id,email,name,phone,role,clearance,affiliation,claimed_affiliation,affiliation_verified,status,data,created_at,updated_at) VALUES(?,?,?,?,'MEMBER',?,?,?,0,'PENDING','{}',?,?)"
      ).bind(
        borrowerId,
        email,
        borrowerName,
        phone,
        clearance,
        affiliation,
        affiliation,
        Date.parse(createdAt),
        Date.parse(createdAt)
      )
    ],
    c.env.DB.prepare(
      "INSERT INTO requests(id,user_id,status,created_at,data) VALUES(?,?,?,?,?)"
    ).bind(id2, borrowerId, request.status, Date.parse(createdAt), JSON.stringify(request)),
    ...request.items.map(
      (line) => c.env.DB.prepare(
        "INSERT INTO request_lines(id,request_id,item_id,equipment_class,quantity,data) VALUES(?,?,?,?,?,?)"
      ).bind(
        line.id,
        id2,
        line.itemId,
        line.equipmentClass,
        line.requestedQuantity,
        JSON.stringify(line)
      )
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      uuid("audit"),
      borrowerId,
      "REQUEST",
      id2,
      "REQUEST_CREATED",
      Date.parse(createdAt),
      JSON.stringify({ id: id2, itemCount: request.items.length })
    ),
    c.env.DB.prepare(
      "INSERT INTO idempotency_keys(key,actor_id,response,created_at) VALUES(?,?,?,?)"
    ).bind(key, borrowerId, JSON.stringify(request), now())
  ];
  try {
    await c.env.DB.batch(statements);
  } catch {
    const retry = await c.env.DB.prepare(
      "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
    ).bind(key, borrowerId).first();
    if (retry) return c.json(parseJson(retry.response));
    return jsonError(
      c,
      409,
      "CONFLICT",
      "Request could not be committed; verify your request and retry"
    );
  }
  return c.json(request, 201);
});
app.delete("/api/v1/requests/:id", async (c) => {
  const actor = await requireMember(c);
  if (!actor) return jsonError(c, 401, "UNAUTHENTICATED", "Sign in to continue");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=? AND user_id=?").bind(c.req.param("id"), actor.id).first();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Request not found");
  const request = parseJson(row.data);
  if (request.decisionStatus !== "PENDING" || request.lifecycleStatus !== "ACTIVE")
    return jsonError(c, 409, "CONFLICT", "Only pending requests can be cancelled");
  request.lifecycleStatus = "CANCELLED";
  request.status = "CANCELLED";
  request.updatedAt = iso2();
  request.timeline.push({
    status: "CANCELLED",
    timestamp: request.updatedAt,
    description: "Request cancelled by member",
    actor: actor.name
  });
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE requests SET status='CANCELLED',data=? WHERE id=? AND user_id=? AND status='PENDING'"
    ).bind(JSON.stringify(request), request.id, actor.id),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(uuid("audit"), actor.id, "REQUEST", request.id, "REQUEST_CANCELLED", now(), "{}")
  ]);
  if (!batch[0]?.meta?.changes)
    return jsonError(c, 409, "CONFLICT", "Request is no longer pending");
  return c.json(request);
});
app.get("/api/v1/board/requests", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const status = c.req.query("decisionStatus");
  const rows = await c.env.DB.prepare(
    `SELECT data FROM requests ${status && status !== "ALL" ? "WHERE status=?" : ""} ORDER BY created_at DESC LIMIT 500`
  ).bind(...status && status !== "ALL" ? [status] : []).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.get("/api/v1/board/requests/:id", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const row = await c.env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(c.req.param("id")).first();
  return row ? c.json(parseJson(row.data)) : jsonError(c, 404, "NOT_FOUND", "Request not found");
});
app.post("/api/v1/board/inventory", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || body.name.trim().length < 1 || body.name.length > 160 || typeof body.category !== "string" || body.category.length > 80 || !["A", "B", "C", "D", "E", "F", "G"].includes(String(body.equipmentClass)) || !Number.isInteger(body.totalQuantity) || Number(body.totalQuantity) < 0 || Number(body.totalQuantity) > 1e5 || !["QUANTITY", "INDIVIDUAL_ASSET"].includes(String(body.trackingMode ?? "QUANTITY")))
    return jsonError(c, 400, "VALIDATION", "Inventory details are invalid");
  const itemId = typeof body.id === "string" ? body.id.slice(0, 100) : uuid("item");
  const timestamp = now();
  const trackingMode = String(body.trackingMode ?? "QUANTITY");
  const inputAssets = Array.isArray(body.assets) ? body.assets : [];
  if (trackingMode === "INDIVIDUAL_ASSET" && inputAssets.length !== Number(body.totalQuantity) || trackingMode === "QUANTITY" && inputAssets.length > 0 || inputAssets.some(
    (asset) => !asset || typeof asset.serialNumber !== "string" || !asset.serialNumber.trim() || asset.serialNumber.length > 120
  ) || new Set(inputAssets.map((asset) => asset.serialNumber.trim())).size !== inputAssets.length)
    return jsonError(
      c,
      400,
      "VALIDATION",
      "Enter a unique serial number for every individually tracked asset"
    );
  const item = {
    ...body,
    id: itemId,
    name: body.name.trim(),
    category: body.category.trim(),
    equipmentClass: body.equipmentClass,
    itemClass: body.equipmentClass,
    trackingMode,
    totalQuantity: Number(body.totalQuantity),
    availableQuantity: Number(body.totalQuantity),
    allocatedQuantity: 0,
    borrowedQuantity: 0,
    damagedQuantity: 0,
    maintenanceQuantity: 0,
    lostQuantity: 0,
    borrowerVisible: typeof body.borrowerVisible === "boolean" ? body.borrowerVisible : ["C", "E"].includes(String(body.equipmentClass)),
    assets: inputAssets.map((asset) => ({
      id: uuid("asset"),
      serialNumber: asset.serialNumber.trim(),
      condition: asset.condition ?? "GOOD",
      state: "AVAILABLE"
    }))
  };
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO inventory(id,name,category,equipment_class,tracking_mode,total_quantity,available_quantity,allocated_quantity,borrowed_quantity,damaged_quantity,maintenance_quantity,lost_quantity,borrower_visible,data,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      itemId,
      item.name,
      item.category,
      item.equipmentClass,
      item.trackingMode,
      item.totalQuantity,
      item.totalQuantity,
      0,
      0,
      0,
      0,
      0,
      item.borrowerVisible ? 1 : 0,
      JSON.stringify(item),
      timestamp
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(
      uuid("audit"),
      actor.id,
      "INVENTORY",
      itemId,
      "INVENTORY_CREATED",
      timestamp,
      JSON.stringify({ itemId })
    ),
    ...item.assets.map(
      (asset) => c.env.DB.prepare(
        "INSERT INTO inventory_assets(id,item_id,serial_number,state,data) VALUES(?,?,?,?,?)"
      ).bind(asset.id, itemId, asset.serialNumber, asset.state, JSON.stringify(asset))
    )
  ];
  try {
    await c.env.DB.batch(statements);
  } catch {
    return jsonError(c, 409, "CONFLICT", "Inventory item or serial number already exists");
  }
  return c.json(item, 201);
});
app.get("/api/v1/board/inventory", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const rows = await c.env.DB.prepare("SELECT data FROM inventory ORDER BY name LIMIT 1000").all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.patch("/api/v1/board/inventory/:id/visibility", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.visible !== "boolean")
    return jsonError(c, 400, "VALIDATION", "Visibility must be true or false");
  const row = await c.env.DB.prepare(
    "SELECT equipment_class,data,updated_at FROM inventory WHERE id=?"
  ).bind(c.req.param("id")).first();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Inventory item not found");
  const record = parseJson(row.data);
  record.borrowerVisible = body.visible;
  const stamp2 = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE inventory SET borrower_visible=?,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        body.visible ? 1 : 0,
        JSON.stringify(record),
        row.updated_at,
        Math.max(stamp2, row.updated_at + 1),
        c.req.param("id")
      ),
      c.env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(
        uuid("audit"),
        actor.id,
        "INVENTORY",
        c.req.param("id"),
        body.visible ? "VISIBILITY_ENABLED" : "VISIBILITY_DISABLED",
        stamp2,
        "{}"
      )
    ]);
  } catch {
    return jsonError(c, 409, "CONFLICT", "Inventory changed; reload and retry");
  }
  return c.json(record);
});
app.get("/api/v1/board/loans", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const rows = await c.env.DB.prepare(
    "SELECT data FROM record_store WHERE kind='loan' ORDER BY updated_at DESC LIMIT 500"
  ).all();
  return c.json((rows.results ?? []).map((row) => parseJson(row.data)));
});
app.post("/api/v1/board/rpc", async (c) => {
  const actor = await requireBoard(c);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Verified board access is required");
  const body = await c.req.json().catch(() => null);
  const result = await dispatchBoardRpc(c.env, actor, body);
  return c.json(result.body, result.status);
});
app.post("/api/v1/board/loans/:id/return", async (c) => {
  const actor = await requireBoard(c, true);
  if (!actor) return jsonError(c, 403, "FORBIDDEN", "Fresh board verification is required");
  const body = await c.req.json().catch(() => ({}));
  const key = c.req.header("Idempotency-Key");
  if (!key || key.length < 16 || key.length > 128)
    return jsonError(c, 400, "VALIDATION", "A valid idempotency key is required");
  const prior = await c.env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  ).bind(key, actor.id).first();
  if (prior) return c.json(parseJson(prior.response));
  const row = await c.env.DB.prepare("SELECT data FROM record_store WHERE kind='loan' AND id=?").bind(c.req.param("id")).first();
  if (!row) return jsonError(c, 404, "NOT_FOUND", "Loan not found");
  const loan = parseJson(row.data);
  if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE")
    return jsonError(c, 409, "CONFLICT", "Loan has already been returned");
  loan.status = "RETURNED";
  loan.returnedAt = iso2();
  loan.returnedBy = actor.id;
  loan.returnNotes = typeof body.notes === "string" ? body.notes.slice(0, 1e3) : void 0;
  const response = JSON.stringify(loan);
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE record_store SET status='RETURNED',data=?,updated_at=? WHERE kind='loan' AND id=? AND status IN ('ACTIVE','OVERDUE')"
    ).bind(response, now(), loan.id),
    c.env.DB.prepare(
      "INSERT INTO idempotency_keys(key,actor_id,response,created_at) VALUES(?,?,?,?)"
    ).bind(key, actor.id, response, now()),
    c.env.DB.prepare(
      "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
    ).bind(uuid("audit"), actor.id, "LOAN", loan.id, "LOAN_RETURNED", now(), "{}")
  ]);
  if (!batch[0]?.meta?.changes)
    return jsonError(c, 409, "CONFLICT", "Loan state changed; reload and try again");
  return c.json(loan);
});
app.notFound(
  (c) => c.req.path.startsWith("/api/") ? jsonError(c, 404, "NOT_FOUND", "API route not found") : c.text("Not found", 404)
);
async function otpHash(env, userId, code) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${userId}:${code}`));
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let value = 0;
  for (let i = 0; i < left.length; i++) value |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return value === 0;
}
function safeImage(value) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }
  if (trimmed.startsWith("<svg") && trimmed.includes("</svg>")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`;
  }
  try {
    const url = new URL(trimmed);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
async function sendStaffCode(env, email, code) {
  if (!env.BREVO_API_KEY) return;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL ?? "noreply@ras-insat.org",
        name: env.BREVO_SENDER_NAME ?? "IEEE RAS INSAT"
      },
      to: [{ email }],
      subject: "Your board sign-in code",
      htmlContent: `<p>Your board sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. Never share this code.</p>`
    })
  });
  if (!response.ok) throw new Error("Email delivery failed");
}
async function cleanExpiredSecurityData(env) {
  const nowMs = now();
  const seconds = Math.floor(nowMs / 1e3) - 24 * 60 * 60;
  const milliseconds = nowMs - 24 * 60 * 6e4;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM rate_limit_buckets WHERE key_hash IN (SELECT key_hash FROM rate_limit_buckets WHERE window_start<? LIMIT 500)"
    ).bind(seconds),
    env.DB.prepare(
      "DELETE FROM registration_intents WHERE email IN (SELECT email FROM registration_intents WHERE expires_at<? LIMIT 500)"
    ).bind(nowMs),
    env.DB.prepare(
      "DELETE FROM staff_challenges WHERE id IN (SELECT id FROM staff_challenges WHERE expires_at<? AND created_at<? LIMIT 500)"
    ).bind(milliseconds, milliseconds),
    env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE key IN (SELECT key FROM idempotency_keys WHERE created_at<? LIMIT 500)"
    ).bind(nowMs - 90 * 24 * 60 * 6e4),
    env.DB.prepare(
      "DELETE FROM verification WHERE id IN (SELECT id FROM verification WHERE expiresAt<? LIMIT 500)"
    ).bind(milliseconds)
  ]);
}
async function expireAllocations(env) {
  const expired = await env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='allocation' AND status='ACTIVE' AND expires_at<=? LIMIT 100"
  ).bind(now()).all();
  for (const row of expired.results ?? []) {
    const allocation = parseJson(row.data);
    const inventoryRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?").bind(allocation.itemId).first();
    if (!inventoryRow) continue;
    const item = parseJson(inventoryRow.data);
    item.availableQuantity += allocation.quantity;
    item.allocatedQuantity -= allocation.quantity;
    allocation.status = "EXPIRED";
    allocation.releasedAt = iso2();
    const statements = [
      env.DB.prepare(
        "UPDATE inventory SET available_quantity=available_quantity+?,allocated_quantity=CASE WHEN allocated_quantity>=? THEN allocated_quantity-? ELSE -1 END,data=?,updated_at=CASE WHEN updated_at=? THEN ? ELSE -1 END WHERE id=?"
      ).bind(
        allocation.quantity,
        allocation.quantity,
        allocation.quantity,
        JSON.stringify(item),
        inventoryRow.updated_at,
        Math.max(now(), inventoryRow.updated_at + 1),
        allocation.itemId
      ),
      env.DB.prepare(
        "UPDATE record_store SET status='EXPIRED',data=?,updated_at=CASE WHEN status='ACTIVE' THEN ? ELSE -1 END WHERE kind='allocation' AND id=?"
      ).bind(JSON.stringify(allocation), now(), row.id),
      env.DB.prepare(
        "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
      ).bind(uuid("audit"), "system", "ALLOCATION", row.id, "ALLOCATION_EXPIRED", now(), "{}")
    ];
    if (item.trackingMode === "INDIVIDUAL_ASSET")
      for (const assetId of allocation.assetIds ?? []) {
        const asset = item.assets?.find((entry) => entry.id === assetId);
        if (!asset || asset.state !== "ALLOCATED")
          throw new Error("Expired allocation asset state is inconsistent");
        asset.state = "AVAILABLE";
        statements.unshift(
          env.DB.prepare(
            "UPDATE inventory_assets SET state=CASE WHEN state='ALLOCATED' THEN 'AVAILABLE' ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
          ).bind(JSON.stringify(asset), asset.id, item.id)
        );
      }
    const event = {
      id: uuid("iev"),
      itemId: item.id,
      itemName: item.name,
      type: "RELEASE_ALLOCATION",
      quantity: allocation.quantity,
      beforeState: {
        allocated: item.allocatedQuantity + allocation.quantity,
        available: item.availableQuantity - allocation.quantity
      },
      afterState: { allocated: item.allocatedQuantity, available: item.availableQuantity },
      reason: "48-hour collection window expired",
      actorUserId: "system",
      actorName: "System",
      timestamp: iso2(),
      ...allocation.assetIds?.length ? { assetIds: allocation.assetIds } : {}
    };
    statements.push(
      env.DB.prepare(
        "INSERT INTO record_store(kind,id,owner_id,status,expires_at,data,updated_at) VALUES('inventory_event',?,?,'RELEASE_ALLOCATION',NULL,?,?)"
      ).bind(event.id, item.id, JSON.stringify(event), now())
    );
    await env.DB.batch(statements);
    const remaining = await env.DB.prepare(
      "SELECT 1 FROM record_store WHERE kind='allocation' AND json_extract(data,'$.requestId')=? AND status='ACTIVE' LIMIT 1"
    ).bind(allocation.requestId).first();
    if (!remaining) {
      const requestRow = await env.DB.prepare("SELECT data FROM requests WHERE id=?").bind(allocation.requestId).first();
      if (requestRow) {
        const request = parseJson(requestRow.data);
        if (request.handoverStatus === "WAITING") {
          request.lifecycleStatus = "EXPIRED";
          request.status = "EXPIRED";
          request.updatedAt = iso2();
          request.timeline.push({
            status: "EXPIRED",
            timestamp: request.updatedAt,
            description: "The 48-hour collection window expired and reservations were released.",
            actor: "System"
          });
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE requests SET status=CASE WHEN status IN ('APPROVED','PARTIALLY_APPROVED') THEN 'EXPIRED' ELSE 'INVALID' END,data=? WHERE id=?"
            ).bind(JSON.stringify(request), request.id),
            env.DB.prepare(
              "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
            ).bind(uuid("audit"), "system", "REQUEST", request.id, "PICKUP_EXPIRED", now(), "{}")
          ]);
        }
      }
    }
  }
}

// src/worker/runtime-env.ts
var cachedUrl;
var cachedClient;
var cachedDatabase;
var cachedAuthDatabase;
function database(url, authToken) {
  if (!cachedClient || cachedUrl !== url) {
    cachedClient?.close();
    cachedUrl = url;
    cachedClient = createLibSqlClient(url, authToken);
    cachedDatabase = new LibSqlD1Database(cachedClient);
    cachedAuthDatabase = createAuthDatabase(cachedClient);
  }
  return { DB: cachedDatabase, AUTH_DATABASE: cachedAuthDatabase };
}
function databaseRateLimit(db, prefix, max, windowSeconds) {
  return {
    limit: async ({ key }) => ({
      success: await rateLimit(db, `${prefix}:${key}`, max, windowSeconds)
    })
  };
}
function createRuntimeEnv(source = process.env) {
  const url = source.TURSO_DATABASE_URL;
  const authToken = source.TURSO_AUTH_TOKEN;
  const secret = source.BETTER_AUTH_SECRET;
  const remoteDatabase = Boolean(url && !url.startsWith("file:"));
  const required = [url, secret];
  if (required.some((value) => !value) || remoteDatabase && !authToken || (secret?.length ?? 0) < 32) {
    throw new Error("Required server configuration is missing");
  }
  const { DB, AUTH_DATABASE } = database(url, authToken);
  return {
    DB,
    AUTH_DATABASE,
    API_RATE_LIMITER: databaseRateLimit(DB, "api", 600, 60),
    AUTH_RATE_LIMITER: databaseRateLimit(DB, "auth", 20, 60),
    APP_ORIGIN: source.APP_ORIGIN,
    ENVIRONMENT: source.VERCEL_ENV === "preview" ? "staging" : "production",
    BETTER_AUTH_SECRET: secret,
    BOARD_STAFF_PASSWORD: source.BOARD_STAFF_PASSWORD || "ras-insat-board-2026",
    BREVO_API_KEY: source.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: source.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: source.BREVO_SENDER_NAME,
    TURNSTILE_SECRET_KEY: source.TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY: source.TURNSTILE_SITE_KEY,
    CRON_SECRET: source.CRON_SECRET,
    VERCEL_URL: source.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: source.VERCEL_PROJECT_PRODUCTION_URL
  };
}

// src/worker/serverless.ts
var handler = getRequestListener((incomingRequest) => {
  const host = incomingRequest.headers.get("x-forwarded-host") || incomingRequest.headers.get("host") || "localhost";
  const proto = incomingRequest.headers.get("x-forwarded-proto") || "https";
  const requestUrl = new URL(incomingRequest.url ?? "/", `${proto}://${host}`);
  const rewrittenPath = requestUrl.searchParams.get("__api_path");
  requestUrl.searchParams.delete("__api_path");
  if (rewrittenPath !== null) requestUrl.pathname = `/api/${rewrittenPath}`;
  const headers = new Headers(incomingRequest.headers);
  const clientIp = incomingRequest.headers.get("x-vercel-forwarded-for") ?? incomingRequest.headers.get("x-forwarded-for");
  headers.set("CF-Connecting-IP", clientIp?.split(",", 1)[0]?.trim() || "unknown");
  const init = {
    method: incomingRequest.method,
    headers,
    redirect: incomingRequest.redirect
  };
  if (incomingRequest.method !== "GET" && incomingRequest.method !== "HEAD" && incomingRequest.body) {
    Object.assign(init, { body: incomingRequest.body, duplex: "half" });
  }
  return app.fetch(new Request(requestUrl, init), createRuntimeEnv());
});
var serverless_default = handler;
export {
  serverless_default as default
};
