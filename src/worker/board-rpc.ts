import type { AppUser, Env } from "./env";

type RpcResult = { status: number; body: unknown };
const stamp = () => Date.now();
const iso = (n = stamp()) => new Date(n).toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const decode = <T>(s: string) => JSON.parse(s) as T;
const scopedKey = async (actorId: string, key: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${actorId}:${key}`))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const ok = (body: unknown, status = 200): RpcResult => ({ status, body });
const fail = (status: number, code: string, message: string): RpcResult => ({
  status,
  body: { error: { code, message } },
});
type Stored = {
  kind: string;
  id: string;
  owner_id: string | null;
  status: string | null;
  expires_at: number | null;
  data: string;
  updated_at: number;
};

async function readOne(env: Env, kind: string, recordId: string) {
  const row = await env.DB.prepare("SELECT * FROM record_store WHERE kind=? AND id=?")
    .bind(kind, recordId)
    .first<Stored>();
  return row ? decode<any>(row.data) : null;
}
async function readMany(env: Env, kind: string, limit = 500) {
  const result = await env.DB.prepare(
    "SELECT data FROM record_store WHERE kind=? ORDER BY updated_at DESC LIMIT ?"
  )
    .bind(kind, limit)
    .all<{ data: string }>();
  return (result.results ?? []).map((row) => decode<any>(row.data));
}
function put(
  env: Env,
  kind: string,
  record: any,
  ownerId: string | null = null,
  status: string | null = null,
  expiry: number | null = null
) {
  return env.DB.prepare(
    `INSERT INTO record_store(kind,id,owner_id,status,expires_at,data,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(kind,id) DO UPDATE SET owner_id=excluded.owner_id,status=excluded.status,expires_at=excluded.expires_at,data=excluded.data,updated_at=excluded.updated_at`
  ).bind(kind, record.id, ownerId, status, expiry, JSON.stringify(record), stamp());
}
function audit(
  env: Env,
  actor: AppUser,
  entityType: string,
  entityId: string,
  action: string,
  data: unknown = {}
) {
  return env.DB.prepare(
    "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)"
  ).bind(id("audit"), actor.id, entityType, entityId, action, stamp(), JSON.stringify(data));
}
function notify(
  env: Env,
  userId: string,
  title: string,
  message: string,
  type: string,
  metadata: Record<string, string> = {}
) {
  const createdAt = iso();
  const notification = {
    id: id("notif"),
    userId,
    title,
    message,
    type,
    read: false,
    createdAt,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
  return put(env, "notification", notification, userId, "UNREAD");
}
const isFresh = (method: string) =>
  [
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
    "exportCsv",
    "logEvent",
  ].includes(method);
const superadminOnly = (service: string, method: string, args: any[]) =>
  (service === "user" && ["updateClearance", "updateRole", "updateStatus"].includes(method)) ||
  (service === "export" &&
    ["USERS", "AUDITS", "STRIKES", "INCIDENTS", "COMPENSATIONS", "AUDIT_LOG"].includes(args[0]));

export async function dispatchBoardRpc(
  env: Env,
  actor: AppUser,
  input: unknown
): Promise<RpcResult> {
  if (!input || typeof input !== "object") return fail(400, "VALIDATION", "Invalid operation");
  const { service, method, args } = input as {
    service?: unknown;
    method?: unknown;
    args?: unknown;
  };
  if (
    typeof service !== "string" ||
    typeof method !== "string" ||
    !Array.isArray(args) ||
    args.length > 8
  )
    return fail(400, "VALIDATION", "Invalid operation");
  if (isFresh(method)) {
    const session = await env.DB.prepare(
      "SELECT fresh_until,revoked_at FROM staff_sessions WHERE user_id=?"
    )
      .bind(actor.id)
      .first<{ fresh_until: number; revoked_at: number | null }>();
    if (!session || session.revoked_at || session.fresh_until <= stamp())
      return fail(403, "FRESH_AUTH_REQUIRED", "Reverify with a new staff code");
  }
  if (superadminOnly(service, method, args) && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Superadmin access is required");

  if (service === "inventory") {
    if (method === "getItems") {
      const rows = await env.DB.prepare("SELECT data FROM inventory ORDER BY name LIMIT 1000").all<{
        data: string;
      }>();
      const filter = args[0] ?? {};
      return ok(
        (rows.results ?? [])
          .map((r) => decode<any>(r.data))
          .filter(
            (item) =>
              (!filter.search ||
                `${item.name} ${item.description} ${item.category}`
                  .toLowerCase()
                  .includes(String(filter.search).toLowerCase())) &&
              (!filter.category || item.category === filter.category) &&
              (!filter.equipmentClass || item.equipmentClass === filter.equipmentClass) &&
              (!filter.lowStockOnly || item.availableQuantity <= 3)
          )
      );
    }
    if (method === "getItemById") {
      const row = await env.DB.prepare("SELECT data FROM inventory WHERE id=?")
        .bind(args[0])
        .first<{ data: string }>();
      return ok(row ? decode(row.data) : null);
    }
    if (method === "createItem") {
      const data = args[0] as any;
      if (
        !data ||
        typeof data.name !== "string" ||
        data.name.trim().length < 1 ||
        data.name.length > 160 ||
        typeof data.category !== "string" ||
        data.category.length > 80 ||
        !["A", "B", "C", "D", "E", "F", "G"].includes(data.equipmentClass) ||
        !["QUANTITY", "INDIVIDUAL_ASSET"].includes(data.trackingMode) ||
        !Number.isInteger(data.totalQuantity) ||
        data.totalQuantity < 0 ||
        data.totalQuantity > 100000
      )
        return fail(400, "VALIDATION", "Invalid inventory item");
      const initialAssets = data.initialAssets ?? [];
      const serials = Array.isArray(initialAssets)
        ? initialAssets.map((asset: any) =>
            typeof asset?.serialNumber === "string" ? asset.serialNumber.trim() : ""
          )
        : [];
      if (
        !Array.isArray(initialAssets) ||
        (data.trackingMode === "INDIVIDUAL_ASSET" && initialAssets.length !== data.totalQuantity) ||
        (data.trackingMode === "QUANTITY" && initialAssets.length > 0) ||
        serials.some((serial: string) => !serial || serial.length > 120) ||
        new Set(serials).size !== serials.length
      )
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
        assets: initialAssets.map((asset: any, index: number) => ({
          serialNumber: serials[index],
          condition: asset.condition ?? "GOOD",
          id: id("asset"),
          state: "AVAILABLE",
        })),
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
        audit(env, actor, "INVENTORY", item.id, "INVENTORY_CREATED"),
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
      const [itemId, visible] = args as [string, boolean];
      if (typeof visible !== "boolean")
        return fail(400, "VALIDATION", "Visibility must be true or false");
      const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
        .bind(itemId)
        .first<{ data: string; updated_at: number }>();
      if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
      const item = decode<any>(row.data);
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
          ),
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
      )
        .bind(...(args[0] ? [args[0]] : []))
        .all<{ data: string }>();
      return ok((rows.results ?? []).map((r) => decode(r.data)));
    }
  }

  if (service === "request") {
    if (method === "getRequests") {
      const filter = args[0] ?? {};
      const rows = await env.DB.prepare(
        "SELECT data FROM requests ORDER BY created_at DESC LIMIT 500"
      ).all<{ data: string }>();
      return ok(
        (rows.results ?? [])
          .map((r) => decode<any>(r.data))
          .filter(
            (r) =>
              (!filter.decisionStatus ||
                filter.decisionStatus === "ALL" ||
                r.decisionStatus === filter.decisionStatus) &&
              (!filter.handoverStatus ||
                filter.handoverStatus === "ALL" ||
                r.handoverStatus === filter.handoverStatus) &&
              (!filter.search ||
                `${r.userName} ${r.userEmail} ${r.items.map((i: any) => i.itemName).join(" ")}`
                  .toLowerCase()
                  .includes(String(filter.search).toLowerCase()))
          )
      );
    }
    if (method === "getRequestById") {
      const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
        .bind(args[0])
        .first<{ data: string }>();
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
      const [loanId, dueDate] = args as [string, string];
      if (!Number.isFinite(Date.parse(dueDate))) return fail(400, "VALIDATION", "Invalid due date");
      const loan = await readOne(env, "loan", loanId);
      if (!loan) return fail(404, "NOT_FOUND", "Loan not found");
      loan.dueDate = dueDate;
      loan.updatedAt = iso();
      await env.DB.batch([
        put(env, "loan", loan, loan.userId, loan.status),
        audit(env, actor, "LOAN", loanId, "DUE_DATE_UPDATED"),
      ]);
      return ok(loan);
    }
  }

  if (service === "allocation") {
    if (method === "getAllocations") {
      const f = args[0] ?? {};
      return ok(
        (await readMany(env, "allocation")).filter(
          (a) =>
            (!f.requestId || a.requestId === f.requestId) &&
            (!f.itemId || a.itemId === f.itemId) &&
            (!f.status || a.status === f.status)
        )
      );
    }
    if (method === "releaseAllocation") {
      const allocation = await readOne(env, "allocation", String(args[0]));
      if (!allocation) return fail(404, "NOT_FOUND", "Allocation not found");
      if (allocation.status !== "ACTIVE")
        return fail(409, "CONFLICT", "Allocation is no longer active");
      if (Date.parse(allocation.expiresAt) <= stamp()) return expireOne(env, actor, allocation);
      allocation.releaseReason = String(args[1] ?? "").slice(0, 1000);
      return releaseOne(env, actor, allocation, "RELEASED");
    }
    if (method === "checkAndExpireAllocations") return ok(await expireDue(env, actor));
  }

  const generic = await genericRecords(env, actor, service, method, args);
  if (generic) return generic;
  return fail(501, "NOT_IMPLEMENTED", "This board operation is not available yet");
}

async function mutateStock(env: Env, actor: AppUser, payload: any): Promise<RpcResult> {
  if (
    !payload ||
    typeof payload.itemId !== "string" ||
    !Number.isInteger(payload.quantity) ||
    payload.quantity === 0 ||
    Math.abs(payload.quantity) > 100000 ||
    typeof payload.reason !== "string" ||
    !payload.reason.trim() ||
    payload.reason.length > 1000
  )
    return fail(400, "VALIDATION", "Stock movement details are invalid");
  const sensitive = ["CORRECT", "REMOVE", "RETIRE", "CONSUME"].includes(payload.type);
  if (sensitive && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Superadmin access is required for this stock correction");
  if (payload.type !== "CORRECT" && payload.quantity < 1)
    return fail(400, "VALIDATION", "Stock movement quantity must be positive");
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
    .bind(payload.itemId)
    .first<{ data: string; updated_at: number }>();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode<any>(row.data);
  const before = {
    total: item.totalQuantity,
    available: item.availableQuantity,
    allocated: item.allocatedQuantity,
    borrowed: item.borrowedQuantity,
    damaged: item.damagedQuantity,
    maintenance: item.maintenanceQuantity,
    lost: item.lostQuantity,
  };
  const q = Math.abs(payload.quantity);
  const selected = payload.assetIds ?? (payload.assetId ? [payload.assetId] : []);
  const assetUpdates: any[] = [];
  const assetDeletes: any[] = [];
  const assetAdds: any[] = [];
  const touched: string[] = [];
  const requireAssets = (count: number, state: string) => {
    if (item.trackingMode === "QUANTITY") {
      if (selected.length)
        throw new Error("Quantity-tracked inventory does not accept asset identifiers");
      return [] as any[];
    }
    if (selected.length !== count || new Set(selected).size !== count)
      throw new Error(`Select exactly ${count} individual assets`);
    const assets = selected.map((assetId: string) =>
      item.assets?.find((asset: any) => asset.id === assetId)
    );
    if (assets.some((asset: any) => !asset || asset.state !== state))
      throw new Error("One or more assets are not in the required stock state");
    return assets;
  };
  const addAssets = (count: number) => {
    if (selected.length)
      throw new Error("Additions require new serial numbers, not existing asset IDs");
    if (item.trackingMode === "QUANTITY") {
      if (payload.newAssets?.length)
        throw new Error("Quantity-tracked inventory does not accept asset serial numbers");
      return [] as any[];
    }
    if (!Array.isArray(payload.newAssets) || payload.newAssets.length !== count)
      throw new Error(`Enter serial numbers for all ${count} added units`);
    const existing = new Set((item.assets ?? []).map((asset: any) => asset.serialNumber));
    const serials = payload.newAssets.map((asset: any) =>
      typeof asset.serialNumber === "string" ? asset.serialNumber.trim() : ""
    );
    if (
      serials.some((serial: string) => !serial || serial.length > 120) ||
      new Set(serials).size !== serials.length ||
      serials.some((serial: string) => existing.has(serial))
    )
      throw new Error("Added asset serial numbers must be unique and nonempty");
    const added = payload.newAssets.map((asset: any, index: number) => ({
      id: id("asset"),
      serialNumber: serials[index],
      condition: asset.condition ?? "GOOD",
      state: "AVAILABLE",
    }));
    item.assets ??= [];
    item.assets.push(...added);
    assetAdds.push(...added);
    touched.push(...added.map((asset: any) => asset.id));
    return added;
  };
  try {
    if (payload.type === "ADD" || (payload.type === "CORRECT" && payload.quantity > 0)) {
      addAssets(q);
      item.totalQuantity += q;
      item.availableQuantity += q;
    } else if (
      payload.type === "REMOVE" ||
      payload.type === "RETIRE" ||
      payload.type === "CONSUME" ||
      (payload.type === "CORRECT" && payload.quantity < 0)
    ) {
      if (item.availableQuantity < q)
        return fail(409, "CONFLICT", "Only available units can be removed");
      const assets = requireAssets(q, "AVAILABLE");
      if (assets.length) {
        item.assets = item.assets.filter((asset: any) => !selected.includes(asset.id));
        assetDeletes.push(...selected);
        touched.push(...selected);
      }
      item.totalQuantity -= q;
      item.availableQuantity -= q;
    } else if (["DAMAGE", "REPAIR", "RECOVER"].includes(payload.type)) {
      const [from, to, fromState, toState, condition] =
        payload.type === "DAMAGE"
          ? ["availableQuantity", "damagedQuantity", "AVAILABLE", "DAMAGED", "DAMAGED"]
          : payload.type === "REPAIR"
            ? ["damagedQuantity", "availableQuantity", "DAMAGED", "AVAILABLE", "GOOD"]
            : ["lostQuantity", "availableQuantity", "LOST", "AVAILABLE", "GOOD"];
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
  if (
    item.totalQuantity < 0 ||
    [
      "availableQuantity",
      "allocatedQuantity",
      "borrowedQuantity",
      "damagedQuantity",
      "maintenanceQuantity",
      "lostQuantity",
    ].some((k) => item[k] < 0) ||
    item.totalQuantity !==
      item.availableQuantity +
        item.allocatedQuantity +
        item.borrowedQuantity +
        item.damagedQuantity +
        item.maintenanceQuantity +
        item.lostQuantity
  )
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
      lost: item.lostQuantity,
    },
    reason: payload.reason.trim(),
    actorUserId: actor.id,
    actorName: actor.name,
    timestamp,
    ...(touched.length ? { assetIds: touched } : {}),
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
    ...assetDeletes.map((assetId: string) =>
      env.DB.prepare(
        "DELETE FROM inventory_assets WHERE id=? AND item_id=? AND state='AVAILABLE'"
      ).bind(assetId, item.id)
    ),
    ...assetAdds.map((asset: any) =>
      env.DB.prepare(
        "INSERT INTO inventory_assets(id,item_id,serial_number,state,data) VALUES(?,?,?,?,?)"
      ).bind(asset.id, item.id, asset.serialNumber, asset.state, JSON.stringify(asset))
    ),
    ...assetUpdates.map((asset: any) =>
      env.DB.prepare(
        "UPDATE inventory_assets SET state=CASE WHEN state IN ('AVAILABLE','DAMAGED','LOST') THEN ? ELSE 'INVALID' END,data=? WHERE id=? AND item_id=?"
      ).bind(asset.state, JSON.stringify(asset), asset.id, item.id)
    ),
    put(env, "inventory_event", event, item.id, event.type),
    audit(env, actor, "INVENTORY", item.id, "STOCK_" + payload.type, { quantity: q }),
  ];
  try {
    await env.DB.batch(stmts);
  } catch {
    return fail(409, "CONFLICT", "Inventory or asset state changed; reload and try again");
  }
  return ok({ item, event });
}

async function updateAsset(env: Env, actor: AppUser, payload: any): Promise<RpcResult> {
  if (!payload?.itemId || !payload?.assetId)
    return fail(400, "VALIDATION", "Asset details are invalid");
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
    .bind(payload.itemId)
    .first<{ data: string; updated_at: number }>();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode<any>(row.data);
  const asset = item.assets?.find((entry: any) => entry.id === payload.assetId);
  if (!asset) return fail(404, "NOT_FOUND", "Asset not found");
  const oldState = asset.state;
  const nextState =
    payload.state ??
    (typeof payload.isAvailable === "boolean"
      ? payload.isAvailable
        ? "AVAILABLE"
        : payload.condition === "DAMAGED"
          ? "DAMAGED"
          : "MAINTENANCE"
      : oldState);
  const buckets: Record<string, string> = {
    AVAILABLE: "availableQuantity",
    ALLOCATED: "allocatedQuantity",
    BORROWED: "borrowedQuantity",
    DAMAGED: "damagedQuantity",
    MAINTENANCE: "maintenanceQuantity",
    LOST: "lostQuantity",
  };
  if (
    !buckets[nextState] ||
    !new Set(["AVAILABLE", "DAMAGED", "MAINTENANCE"]).has(oldState) ||
    !new Set(["AVAILABLE", "DAMAGED", "MAINTENANCE"]).has(nextState)
  )
    return fail(
      409,
      "CONFLICT",
      "Allocation, custody, and loss states use their dedicated workflows"
    );
  if (
    payload.condition &&
    !new Set(["GOOD", "MINOR_ISSUE", "DAMAGED", "MAINTENANCE", "LOST"]).has(payload.condition)
  )
    return fail(400, "VALIDATION", "Asset condition is invalid");
  asset.state = nextState;
  if (payload.condition) asset.condition = payload.condition;
  if (typeof payload.notes === "string") asset.notes = payload.notes.slice(0, 1000);
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
        to: nextState,
      }),
    ]);
  } catch {
    return fail(409, "CONFLICT", "Asset state changed; reload and try again");
  }
  return ok(asset);
}

async function reviewRequest(env: Env, actor: AppUser, payload: any): Promise<RpcResult> {
  if (
    !payload ||
    typeof payload.requestId !== "string" ||
    !Array.isArray(payload.lines) ||
    payload.lines.length > 40
  )
    return fail(400, "VALIDATION", "Request review is invalid");
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
    .bind(payload.requestId)
    .first<{ data: string }>();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode<any>(row.data);
  if (request.decisionStatus !== "PENDING")
    return fail(409, "CONFLICT", "Request has already been reviewed");
  if (
    payload.lines.length !== request.items.length ||
    new Set(payload.lines.map((l: any) => l.lineId)).size !== request.items.length
  )
    return fail(400, "VALIDATION", "Review each request line exactly once");
  const member = await env.DB.prepare("SELECT status,clearance FROM app_users WHERE id=?")
    .bind(request.userId)
    .first<{ status: string; clearance: string }>();
  if (!member || member.status !== "ACTIVE")
    return fail(409, "CONFLICT", "Member is not eligible to borrow");
  const strikes = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='strike' AND owner_id=? AND status='ACTIVE'"
  )
    .bind(request.userId)
    .first<{ count: number }>();
  if ((strikes?.count ?? 0) >= 4) return fail(409, "CONFLICT", "Member is not eligible to borrow");
  const allocations: any[] = [];
  const statements: any[] = [];
  const timestamp = iso();
  let total = 0;
  for (const choice of payload.lines) {
    const line = request.items.find((l: any) => l.id === choice.lineId);
    if (
      !line ||
      !Number.isInteger(choice.approvedQuantity) ||
      choice.approvedQuantity < 0 ||
      choice.approvedQuantity > line.requestedQuantity ||
      !["C", "E"].includes(line.equipmentClass)
    )
      return fail(400, "VALIDATION", "Invalid line quantity or request class");
    line.approvedQuantity = choice.approvedQuantity;
    line.status = choice.approvedQuantity ? "APPROVED" : "REJECTED";
    if (!choice.approvedQuantity) {
      line.rejectionReason = String(choice.rejectionReason ?? "Not approved").slice(0, 500);
      continue;
    }
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
      .bind(line.itemId)
      .first<{ data: string; updated_at: number }>();
    if (!itemRow) return fail(409, "CONFLICT", "Inventory item no longer exists");
    const item = decode<any>(itemRow.data);
    const quantity = choice.approvedQuantity;
    let assetIds: string[] = [];
    if (item.trackingMode === "INDIVIDUAL_ASSET") {
      assetIds = choice.assignedAssetIds ?? [];
      if (
        !Array.isArray(assetIds) ||
        assetIds.length !== quantity ||
        new Set(assetIds).size !== quantity
      )
        return fail(400, "VALIDATION", "Select exactly the approved number of unique assets");
      const selected = item.assets?.filter((asset: any) => assetIds.includes(asset.id));
      if (
        selected?.length !== quantity ||
        selected.some((asset: any) => asset.state !== "AVAILABLE")
      )
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
      expiresAt: new Date(stamp() + 48 * 60 * 60_000).toISOString(),
      allocatedBy: actor.id,
      allocatedByName: actor.name,
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
    (sum: number, line: any) => sum + line.requestedQuantity,
    0
  );
  const decision =
    total === 0 ? "REJECTED" : total === requested ? "APPROVED" : "PARTIALLY_APPROVED";
  request.decisionStatus = decision;
  request.status = decision;
  request.reviewedAt = timestamp;
  request.reviewedBy = actor.name;
  request.decisionNotes = String(payload.decisionNotes ?? "").slice(0, 1000);
  request.pickupDeadline = total ? new Date(stamp() + 48 * 60 * 60_000).toISOString() : undefined;
  if (!total) request.lifecycleStatus = "CLOSED";
  request.timeline.push({
    status: decision,
    timestamp,
    description: `Request reviewed: ${decision}`,
    actor: actor.name,
  });
  request.updatedAt = timestamp;
  statements.unshift(
    env.DB.prepare(
      "UPDATE requests SET status=CASE WHEN status='PENDING' THEN ? ELSE 'INVALID' END,data=? WHERE id=?"
    ).bind(decision, JSON.stringify(request), request.id)
  );
  statements.push(
    ...request.items.map((line: any) =>
      env.DB.prepare("UPDATE request_lines SET data=? WHERE id=? AND request_id=?").bind(
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
      total
        ? `Your request ${request.id} is ready for collection within 48 hours.`
        : `Your request ${request.id} was declined.`,
      decision === "REJECTED"
        ? "REQUEST_REJECTED"
        : decision === "APPROVED"
          ? "REQUEST_APPROVED"
          : "REQUEST_PARTIALLY_APPROVED",
      { requestId: request.id }
    ),
    audit(env, actor, "REQUEST", request.id, "REQUEST_REVIEWED", {
      decision,
      allocationCount: allocations.length,
    })
  );
  try {
    await env.DB.batch(statements);
  } catch {
    return fail(409, "CONFLICT", "Stock changed during review; reload the request");
  }
  return ok(request);
}

async function rejectRequest(
  env: Env,
  actor: AppUser,
  requestId: string,
  reason: string
): Promise<RpcResult> {
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
    .bind(requestId)
    .first<{ data: string }>();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode<any>(row.data);
  if (request.decisionStatus !== "PENDING")
    return fail(409, "CONFLICT", "Request has already been reviewed");
  const time = iso();
  request.decisionStatus = "REJECTED";
  request.status = "REJECTED";
  request.lifecycleStatus = "CLOSED";
  request.rejectionReason = String(reason ?? "").slice(0, 1000);
  request.reviewedAt = time;
  request.reviewedBy = actor.name;
  request.updatedAt = time;
  request.items.forEach((line: any) => {
    line.approvedQuantity = 0;
    line.status = "REJECTED";
    line.rejectionReason = request.rejectionReason;
  });
  request.timeline.push({
    status: "REJECTED",
    timestamp: time,
    description: request.rejectionReason,
    actor: actor.name,
  });
  try {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE requests SET status=CASE WHEN status='PENDING' THEN 'REJECTED' ELSE 'INVALID' END,data=? WHERE id=?"
      ).bind(JSON.stringify(request), request.id),
      ...request.items.map((line: any) =>
        env.DB.prepare("UPDATE request_lines SET data=? WHERE id=? AND request_id=?").bind(
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
        reason: request.rejectionReason,
      }),
    ]);
  } catch {
    return fail(409, "CONFLICT", "Request has already been reviewed");
  }
  return ok(request);
}

async function handover(env: Env, actor: AppUser, payload: any): Promise<RpcResult> {
  if (!payload || typeof payload.requestId !== "string")
    return fail(400, "VALIDATION", "Handover details are invalid");
  const row = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
    .bind(payload.requestId)
    .first<{ data: string }>();
  if (!row) return fail(404, "NOT_FOUND", "Request not found");
  const request = decode<any>(row.data);
  const suppliedKey = payload.idempotencyKey;
  if (typeof suppliedKey !== "string" || suppliedKey.length < 16 || suppliedKey.length > 128)
    return fail(400, "VALIDATION", "A valid idempotency key is required");
  const key = await scopedKey(actor.id, suppliedKey);
  const replay = await env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  )
    .bind(key, actor.id)
    .first<{ response: string }>();
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
  const stmts: any[] = [];
  for (const allocation of allocations) {
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
      .bind(allocation.itemId)
      .first<{ data: string; updated_at: number }>();
    if (!itemRow) return fail(409, "CONFLICT", "Reserved item no longer exists");
    const item = decode<any>(itemRow.data);
    item.allocatedQuantity -= allocation.quantity;
    item.borrowedQuantity += allocation.quantity;
    if (item.trackingMode === "INDIVIDUAL_ASSET") {
      const assetIds = allocation.assetIds ?? [];
      const handover = payload.lineHandoverDetails?.find(
        (entry: any) => entry.lineId === allocation.requestLineId
      );
      const serials = handover?.serialNumbers ?? [];
      if (assetIds.length !== allocation.quantity || serials.length !== assetIds.length)
        return fail(409, "CONFLICT", "Confirm every reserved serial number at handover");
      const selected = item.assets?.filter((asset: any) => assetIds.includes(asset.id));
      if (
        selected?.length !== assetIds.length ||
        selected.some((asset: any) => asset.state !== "ALLOCATED") ||
        serials.some(
          (serial: string) => !selected.some((asset: any) => asset.serialNumber === serial)
        )
      )
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
    const line = request.items.find((l: any) => l.id === allocation.requestLineId);
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
      assetIds: allocation.assetIds,
    });
  }
  request.handoverStatus = "HANDED_OVER";
  request.status = "HANDED_OVER";
  request.updatedAt = time;
  request.timeline.push({
    status: "HANDED_OVER",
    timestamp: time,
    description: "Equipment handed over",
    actor: actor.name,
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
    notes: typeof payload.notes === "string" ? payload.notes.slice(0, 1000) : undefined,
    createdAt: time,
    updatedAt: time,
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

async function confirmReturn(env: Env, actor: AppUser, payload: any): Promise<RpcResult> {
  if (
    !payload ||
    typeof payload.loanId !== "string" ||
    !Array.isArray(payload.items) ||
    payload.items.length > 100 ||
    typeof payload.idempotencyKey !== "string"
  )
    return fail(400, "VALIDATION", "Return inspection is invalid");
  const suppliedKey = payload.idempotencyKey;
  if (suppliedKey.length < 16 || suppliedKey.length > 128)
    return fail(400, "VALIDATION", "A valid idempotency key is required");
  const key = await scopedKey(actor.id, suppliedKey);
  const replay = await env.DB.prepare(
    "SELECT response FROM idempotency_keys WHERE key=? AND actor_id=?"
  )
    .bind(key, actor.id)
    .first<{ response: string }>();
  if (replay) return ok(decode(replay.response));
  const loan = await readOne(env, "loan", payload.loanId);
  if (!loan) return fail(404, "NOT_FOUND", "Loan not found");
  if (loan.lifecycleStatus !== "ACTIVE") return fail(409, "CONFLICT", "Loan is already closed");
  const seen = new Set<string>();
  const statements: any[] = [];
  for (const entry of payload.items) {
    if (
      !entry ||
      typeof entry.lineItemId !== "string" ||
      seen.has(entry.lineItemId) ||
      !Number.isInteger(entry.returnedQuantity) ||
      entry.returnedQuantity < 0
    )
      return fail(400, "VALIDATION", "Return quantities are invalid");
    seen.add(entry.lineItemId);
    const line = loan.items.find((item: any) => item.id === entry.lineItemId);
    if (!line || entry.returnedQuantity + line.returnedQuantity > line.borrowedQuantity)
      return fail(409, "CONFLICT", "Return quantity exceeds the remaining loan quantity");
    const damaged = Number(
      entry.damagedQuantity ?? (entry.condition === "DAMAGED" ? entry.returnedQuantity : 0)
    );
    const lost = Number(entry.lostQuantity ?? 0);
    if (
      !Number.isInteger(damaged) ||
      !Number.isInteger(lost) ||
      damaged < 0 ||
      lost < 0 ||
      damaged + lost > entry.returnedQuantity
    )
      return fail(400, "VALIDATION", "Damaged and lost quantities exceed the returned quantity");
    const itemRow = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
      .bind(line.itemId)
      .first<{ data: string; updated_at: number }>();
    if (!itemRow) return fail(409, "CONFLICT", "Loan item no longer exists");
    const item = decode<any>(itemRow.data);
    const returned = entry.returnedQuantity - damaged - lost;
    let assetIds: string[] = [];
    if (item.trackingMode === "INDIVIDUAL_ASSET" && entry.returnedQuantity) {
      assetIds = entry.assetIds ?? [];
      if (assetIds.length !== entry.returnedQuantity || new Set(assetIds).size !== assetIds.length)
        return fail(400, "VALIDATION", "Select every returned or reconciled asset");
      const already = new Set(line.returnedAssetIds ?? []);
      const allowed = new Set(line.assetIds ?? []);
      if (assetIds.some((assetId: string) => already.has(assetId) || !allowed.has(assetId)))
        return fail(
          409,
          "CONFLICT",
          "An asset was already returned or does not belong to this loan line"
        );
      const returnedStates = new Map<string, string>();
      assetIds.forEach((assetId: string, index: number) =>
        returnedStates.set(
          assetId,
          index < damaged ? "DAMAGED" : index < damaged + lost ? "LOST" : "AVAILABLE"
        )
      );
      const selected = item.assets?.filter((asset: any) => returnedStates.has(asset.id));
      if (
        selected?.length !== entry.returnedQuantity ||
        selected.some((asset: any) => asset.state !== "BORROWED")
      )
        return fail(409, "CONFLICT", "One or more assets are no longer recorded as borrowed");
      for (const asset of selected) {
        asset.state = returnedStates.get(asset.id);
        asset.condition =
          asset.state === "DAMAGED"
            ? "DAMAGED"
            : asset.state === "LOST"
              ? "LOST"
              : (entry.condition ?? "GOOD");
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
    (line: any) => line.returnedQuantity >= line.borrowedQuantity
  );
  loan.returnStatus = allReturned ? "COMPLETE" : "PARTIAL";
  loan.status = allReturned ? "RETURNED" : "PARTIALLY_RETURNED";
  loan.lifecycleStatus = allReturned ? "CLOSED" : "ACTIVE";
  loan.updatedAt = iso();
  loan.returnNotes = String(payload.inspectionNotes ?? "").slice(0, 1000);
  const result = JSON.stringify(loan);
  statements.unshift(put(env, "loan", loan, loan.userId, loan.status));
  statements.push(
    notify(
      env,
      loan.userId,
      "Return inspection recorded",
      allReturned
        ? `Loan ${loan.id} is closed.`
        : `The return for loan ${loan.id} was recorded. Remaining items stay in your custody.`,
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

async function releaseOne(
  env: Env,
  actor: AppUser,
  allocation: any,
  status: "EXPIRED" | "RELEASED"
): Promise<RpcResult> {
  const row = await env.DB.prepare("SELECT data,updated_at FROM inventory WHERE id=?")
    .bind(allocation.itemId)
    .first<{ data: string; updated_at: number }>();
  if (!row) return fail(404, "NOT_FOUND", "Inventory item not found");
  const item = decode<any>(row.data);
  const before = {
    total: item.totalQuantity,
    available: item.availableQuantity,
    allocated: item.allocatedQuantity,
  };
  item.availableQuantity += allocation.quantity;
  item.allocatedQuantity -= allocation.quantity;
  const statements: any[] = [
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
    ),
  ];
  if (item.trackingMode === "INDIVIDUAL_ASSET")
    for (const assetId of allocation.assetIds ?? []) {
      const asset = item.assets?.find((entry: any) => entry.id === assetId);
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
  allocation.releaseReason =
    status === "EXPIRED" ? "48-hour collection window expired" : allocation.releaseReason;
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
      allocated: item.allocatedQuantity,
    },
    reason: allocation.releaseReason ?? "Allocation released",
    actorUserId: actor.id,
    actorName: actor.name,
    timestamp: allocation.releasedAt,
    ...(allocation.assetIds?.length ? { assetIds: allocation.assetIds } : {}),
  };
  statements.push(
    env.DB.prepare(
      "UPDATE record_store SET status=?,data=?,updated_at=CASE WHEN status='ACTIVE' THEN ? ELSE -1 END WHERE kind='allocation' AND id=?"
    ).bind(status, JSON.stringify(allocation), stamp(), allocation.id),
    put(env, "inventory_event", event, item.id, event.type),
    audit(env, actor, "ALLOCATION", allocation.id, `ALLOCATION_${status}`, {
      itemId: item.id,
      quantity: allocation.quantity,
      reason: allocation.releaseReason ?? "Allocation released",
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
    )
      .bind(allocation.requestId)
      .first();
    if (!remaining) {
      const requestRow = await env.DB.prepare("SELECT data FROM requests WHERE id=?")
        .bind(allocation.requestId)
        .first<{ data: string }>();
      if (requestRow) {
        const request = decode<any>(requestRow.data);
        if (request.handoverStatus === "WAITING") {
          request.lifecycleStatus = "EXPIRED";
          request.status = "EXPIRED";
          request.updatedAt = iso();
          request.timeline.push({
            status: "EXPIRED",
            timestamp: request.updatedAt,
            description: "The 48-hour collection window expired and reservations were released.",
            actor: "System",
          });
          try {
            await env.DB.batch([
              env.DB.prepare(
                "UPDATE requests SET status=CASE WHEN status IN ('APPROVED','PARTIALLY_APPROVED') THEN 'EXPIRED' ELSE 'INVALID' END,data=? WHERE id=?"
              ).bind(JSON.stringify(request), request.id),
              audit(env, actor, "REQUEST", request.id, "PICKUP_EXPIRED"),
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
async function expireOne(env: Env, actor: AppUser, allocation: any): Promise<RpcResult> {
  return releaseOne(env, actor, allocation, "EXPIRED");
}
async function expireDue(env: Env, actor: AppUser) {
  const rows = await env.DB.prepare(
    "SELECT id,data FROM record_store WHERE kind='allocation' AND status='ACTIVE' AND expires_at<=? LIMIT 100"
  )
    .bind(stamp())
    .all<{ id: string; data: string }>();
  let expired = 0;
  for (const row of rows.results ?? []) {
    const result = await expireOne(env, actor, decode(row.data));
    if (result.status === 200) expired++;
  }
  return expired;
}

async function genericRecords(
  env: Env,
  actor: AppUser,
  service: string,
  method: string,
  args: any[]
): Promise<RpcResult | null> {
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
    )
      .bind(limit)
      .all<any>();

    const events = (rows.results ?? []).map((row) => {
      const parsedData = decode<any>(row.data) ?? {};
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
        createdAt:
          typeof row.created_at === "number"
            ? new Date(row.created_at).toISOString()
            : String(row.created_at),
      };
    });
    return ok(events);
  }
  if (service === "insights" && method === "getInsights") return ok(await insights(env));
  if (service === "export" && method === "exportCsv") return exportCsv(env, actor, args[0]);
  if (service === "user" && method === "getUsers") return getUsers(env, args[0]);
  if (service === "user" && method === "getUserById") {
    const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?")
      .bind(args[0])
      .first<any>();
    return ok(row ? publicProfile(row) : null);
  }

  if (
    service === "project" &&
    ["createProject", "updateProject", "assignMember", "removeMember"].includes(method)
  ) {
    const projects = await readMany(env, "project");
    let project: any;
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
      audit(env, actor, "PROJECT", project.id, "PROJECT_" + method.toUpperCase()),
    ]);
    return ok(project);
  }
  if (
    service === "discipline" &&
    [
      "createIncident",
      "resolveIncident",
      "issueStrike",
      "overturnStrike",
      "recordCompensation",
      "updateCompensationStatus",
      "reviewRecommendation",
    ].includes(method)
  ) {
    let kind = "incident",
      record: any;
    if (method === "createIncident") {
      record = {
        ...args[0],
        id: id("incident"),
        status: "OPEN",
        reportedBy: actor.id,
        reportedByName: actor.name,
        reportedAt: iso(),
      };
    } else if (method === "resolveIncident") {
      kind = "incident";
      record = await readOne(env, kind, String(args[0]));
      if (!record) return fail(404, "NOT_FOUND", "Incident not found");
      record.status = "RESOLVED";
      record.resolutionNotes = String(args[1] ?? "").slice(0, 1000);
    } else if (method === "issueStrike") {
      kind = "strike";
      record = {
        ...args[0],
        id: id("strike"),
        status: "ACTIVE",
        issuedBy: actor.id,
        issuedByName: actor.name,
        issuedAt: iso(),
      };
    } else if (method === "overturnStrike") {
      kind = "strike";
      record = await readOne(env, kind, String(args[0]));
      if (!record) return fail(404, "NOT_FOUND", "Strike not found");
      record.status = "OVERTURNED";
      record.overturnedBy = actor.id;
      record.overturnedAt = iso();
      record.reason = String(args[1] ?? "").slice(0, 1000);
    } else if (method === "recordCompensation") {
      kind = "compensation";
      record = {
        ...args[0],
        id: id("comp"),
        status: "PENDING",
        createdAt: iso(),
        updatedAt: iso(),
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
      record.decisionNotes = String(args[2] ?? "").slice(0, 1000);
    }
    const owner = record.userId ?? null;
    await env.DB.batch([
      put(env, kind, record, owner, record.status ?? null),
      audit(env, actor, kind.toUpperCase(), record.id, method.toUpperCase()),
    ]);
    return ok(
      record,
      method === "createIncident" || method === "issueStrike" || method === "recordCompensation"
        ? 201
        : 200
    );
  }
  if (
    service === "audit" &&
    ["startAudit", "recordCounts", "reconcileItem", "completeAudit"].includes(method)
  ) {
    let auditRecord: any;
    if (method === "startAudit") {
      const input = args[0] ?? {};
      const rows = await env.DB.prepare("SELECT id,data FROM inventory").all<{
        id: string;
        data: string;
      }>();
      const items = (rows.results ?? []).map((r) => {
        const item = decode<any>(r.data);
        return {
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          equipmentClass: item.equipmentClass,
          expectedSnapshotQuantity:
            item.availableQuantity +
            item.allocatedQuantity +
            item.damagedQuantity +
            item.maintenanceQuantity,
          movementsSinceSnapshot: 0,
          adjustedExpectedQuantity:
            item.availableQuantity +
            item.allocatedQuantity +
            item.damagedQuantity +
            item.maintenanceQuantity,
          status: "PENDING_COUNT",
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
        notes: String(input.notes ?? "").slice(0, 1000),
      };
    } else {
      const input = args[0];
      auditRecord = await readOne(env, "inventory_audit", String(input.auditId));
      if (!auditRecord) return fail(404, "NOT_FOUND", "Audit not found");
      if (method === "recordCounts") {
        for (const count of input.counts ?? []) {
          const item = auditRecord.items.find((i: any) => i.itemId === count.itemId);
          if (item) {
            item.physicalCount = count.physicalCount;
            item.countedAt = iso();
            item.discrepancy = count.physicalCount - item.adjustedExpectedQuantity;
            item.status = item.discrepancy === 0 ? "MATCHED" : "DISCREPANCY";
          }
        }
      } else if (method === "reconcileItem") {
        const item = auditRecord.items.find((i: any) => i.itemId === input.itemId);
        if (!item) return fail(404, "NOT_FOUND", "Audit item not found");
        item.status = "RECONCILED";
        item.resolutionNotes = String(input.resolutionNotes ?? "").slice(0, 1000);
      } else {
        auditRecord.status = "RECONCILED";
        auditRecord.completedAt = iso();
        auditRecord.completedBy = actor.id;
      }
    }
    auditRecord.updatedAt = iso();
    await env.DB.batch([
      put(env, "inventory_audit", auditRecord, null, auditRecord.status),
      audit(env, actor, "AUDIT", auditRecord.id, "AUDIT_" + method.toUpperCase()),
    ]);
    return ok(auditRecord);
  }
  if (service === "user" && method === "createUser") return createUser(env, actor, args[0]);
  if (service === "user" && method === "removeUser") return removeUser(env, actor, args[0]);
  if (
    service === "user" &&
    ["processUser", "updateClearance", "updateRole", "updateStatus"].includes(method)
  )
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
      createdAt: iso(),
    };
    await env.DB.batch([
      put(env, "audit_event", event, actor.id, event.action),
      audit(env, actor, "AUDIT", event.id, "AUDIT_EVENT_RECORDED"),
    ]);
    return ok(event, 201);
  }
  return null;
}

async function updateUser(
  env: Env,
  actor: AppUser,
  method: string,
  input: any
): Promise<RpcResult> {
  const targetId = String(input?.userId ?? "");
  if (!targetId) return fail(400, "VALIDATION", "Member ID is required");
  const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(targetId)
    .first<any>();
  if (!row) return fail(404, "NOT_FOUND", "Member not found");
  let values: any = {};
  if (method === "processUser") {
    const affiliation = input.verifiedAffiliation ?? input.affiliation;
    if (!["IEEE", "AEROBOTIX", "EXTERNAL", "EUROBOT", "RAS_BOARD"].includes(affiliation))
      return fail(400, "VALIDATION", "Affiliation is invalid");
    values = {
      affiliation,
      claimed_affiliation: row.claimed_affiliation,
      affiliation_verified: 1,
      clearance:
        affiliation === "EUROBOT" || affiliation === "RAS_BOARD"
          ? "V"
          : affiliation === "IEEE"
            ? "III"
            : affiliation === "AEROBOTIX"
              ? "II"
              : "I",
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
      `UPDATE app_users SET ${Object.keys(values)
        .map((key) => `${key}=?`)
        .join(",")},updated_at=? WHERE id=?`
    ).bind(...Object.values(values), stamp(), targetId),
  ];
  if (
    (method === "updateRole" && values.role === "MEMBER") ||
    (method === "updateStatus" && values.status !== "ACTIVE")
  )
    statements.push(
      env.DB.prepare(
        "UPDATE staff_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL"
      ).bind(stamp(), targetId)
    );
  statements.push(
    audit(env, actor, "USER", targetId, "USER_" + method.toUpperCase(), {
      fields: Object.keys(values),
    })
  );
  await env.DB.batch(statements);
  const updated = await env.DB.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(targetId)
    .first<any>();
  return ok(publicProfile(updated));
}

async function createUser(env: Env, actor: AppUser, input: any): Promise<RpcResult> {
  if (actor.role !== "SUPERADMIN" && actor.role !== "OPERATOR")
    return fail(403, "FORBIDDEN", "Staff access is required to add people");
  if (!input || typeof input.email !== "string" || !input.email.includes("@"))
    return fail(400, "VALIDATION", "Valid email address is required");
  if (typeof input.name !== "string" || input.name.trim().length < 2)
    return fail(400, "VALIDATION", "Valid name is required");

  const email = input.email.trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM app_users WHERE email=? COLLATE NOCASE")
    .bind(email)
    .first();
  if (existing) return fail(409, "CONFLICT", "A user with this email already exists");

  const targetRole = input.role || "MEMBER";
  if (!["MEMBER", "OPERATOR", "SUPERADMIN"].includes(targetRole))
    return fail(400, "VALIDATION", "Invalid role specified");
  if (targetRole === "SUPERADMIN" && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Only Superadmins can create other Superadmins");

  const affiliation = input.affiliation || (targetRole === "MEMBER" ? "IEEE" : "RAS_BOARD");
  const clearance =
    input.clearance ||
    (targetRole === "SUPERADMIN"
      ? "VI"
      : targetRole === "OPERATOR"
        ? "V"
        : affiliation === "IEEE"
          ? "III"
          : affiliation === "AEROBOTIX"
            ? "II"
            : "I");
  const phone = input.phone ? String(input.phone).trim() : "";
  const newId = crypto.randomUUID();
  const timestamp = stamp();
  const userData = {};

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
      targetRole === "SUPERADMIN"
        ? "SUPERADMIN_ROLE"
        : targetRole === "OPERATOR"
          ? "OPERATOR_ROLE"
          : "AFFILIATION",
      affiliation,
      affiliation,
      JSON.stringify(userData),
      timestamp,
      timestamp
    ),
    audit(env, actor, "USER", newId, "USER_CREATED", { email, role: targetRole, clearance }),
  ]);

  const createdRow = await env.DB.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(newId)
    .first<any>();
  return ok(createdRow ? publicProfile(createdRow) : null, 201);
}

async function removeUser(env: Env, actor: AppUser, input: any): Promise<RpcResult> {
  const targetId = typeof input === "string" ? input : String(input?.userId ?? "");
  if (!targetId) return fail(400, "VALIDATION", "User ID is required");
  if (targetId === actor.id) return fail(400, "VALIDATION", "You cannot remove your own account");

  const row = await env.DB.prepare("SELECT * FROM app_users WHERE id=?")
    .bind(targetId)
    .first<any>();
  if (!row) return fail(404, "NOT_FOUND", "User not found");
  if (row.role === "SUPERADMIN" && actor.role !== "SUPERADMIN")
    return fail(403, "FORBIDDEN", "Only Superadmins can remove another Superadmin");

  // Safeguard: Refuse deletion if user holds active/overdue loans
  const activeLoans = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM record_store WHERE kind='loan' AND owner_id=? AND status IN ('ACTIVE', 'OVERDUE')"
  )
    .bind(targetId)
    .first<{ count: number }>();
  if (activeLoans && activeLoans.count > 0) {
    return fail(
      409,
      "CONFLICT",
      `Cannot remove ${row.name}: user currently possesses ${activeLoans.count} active borrowed equipment item(s). Return all items first.`
    );
  }

  // Safeguard: Refuse deletion if user has pending borrow requests
  const activeRequests = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM requests WHERE user_id=? AND status IN ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED')"
  )
    .bind(targetId)
    .first<{ count: number }>();
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
    env.DB.prepare("DELETE FROM record_store WHERE kind='notification' AND owner_id=?").bind(
      targetId
    ),
    audit(env, actor, "USER", targetId, "USER_REMOVED", {
      email: row.email,
      name: row.name,
      role: row.role,
    }),
  ]);

  return ok({ success: true });
}

function publicProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    role: row.role,
    clearance: row.clearance,
    clearanceSource: row.clearance_source ?? undefined,
    affiliation: row.affiliation,
    claimedAffiliation: row.claimed_affiliation ?? undefined,
    verifiedAffiliation: row.affiliation_verified ? row.affiliation : undefined,
    isProcessed: row.affiliation_verified === 1,
    status: row.status,
    strikesCount: 0,
    strikes: [],
    joinedDate: iso(row.created_at),
    activeLoansCount: 0,
    totalRequestsCount: 0,
  };
}
async function getUsers(env: Env, filter: any) {
  const rows = await env.DB.prepare(
    "SELECT * FROM app_users ORDER BY created_at DESC LIMIT 1000"
  ).all<any>();
  return ok(
    (rows.results ?? [])
      .map(publicProfile)
      .filter(
        (u: any) =>
          (!filter?.search ||
            `${u.name} ${u.email}`.toLowerCase().includes(String(filter.search).toLowerCase())) &&
          (!filter?.role || filter.role === "ALL" || u.role === filter.role) &&
          (!filter?.clearance || filter.clearance === "ALL" || u.clearance === filter.clearance) &&
          (!filter?.status || filter.status === "ALL" || u.status === filter.status) &&
          (!filter?.unprocessedOnly || !u.isProcessed)
      )
  );
}
async function insights(env: Env) {
  const [inventoryRows, requestCount, loans, projects, incidents, recommendations] =
    await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS items,COALESCE(SUM(total_quantity),0) total,COALESCE(SUM(available_quantity),0) available,COALESCE(SUM(allocated_quantity),0) allocated FROM inventory"
      ).first<any>(),
      env.DB.prepare("SELECT COUNT(*) count FROM requests").first<any>(),
      env.DB.prepare("SELECT data,status FROM record_store WHERE kind='loan'").all<any>(),
      env.DB.prepare("SELECT COUNT(*) count FROM record_store WHERE kind='project'").first<any>(),
      env.DB.prepare(
        "SELECT COUNT(*) count FROM record_store WHERE kind='incident' AND status='OPEN'"
      ).first<any>(),
      env.DB.prepare(
        "SELECT COUNT(*) count FROM record_store WHERE kind='recommendation' AND status='PENDING_REVIEW'"
      ).first<any>(),
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
      lostUnits: 0,
    },
    borrowing: {
      totalRequestsCount: requestCount?.count ?? 0,
      requestsThisMonth: 0,
      approvalRatePercent: 0,
      partialApprovalRatePercent: 0,
      activeLoansCount: loanList.filter((r: any) => r.status === "ACTIVE" || r.status === "OVERDUE")
        .length,
      averageDurationDays: null,
      overdueLoansCount: loanList.filter((r: any) => r.status === "OVERDUE").length,
      overdueRatePercent: 0,
    },
    equipment: { topBorrowedItems: [], frequentlyUnavailableItems: [], mostDamagedItems: [] },
    projects: {
      projectsCount: projects?.count ?? 0,
      equipmentByProject: [],
      requestsByProject: [],
    },
    discipline: {
      activeStrikesByLevel: {},
      pendingRecommendationsCount: recommendations?.count ?? 0,
      openIncidentsCount: incidents?.count ?? 0,
      totalCompensationDue: 0,
    },
  };
}
async function exportCsv(env: Env, actor: AppUser, dataset: string): Promise<RpcResult> {
  const allowed: Record<string, string> = {
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
    AUDIT_LOG: "audit_event",
  };
  if (!allowed[dataset]) return fail(400, "VALIDATION", "Export dataset is invalid");
  const records =
    dataset === "INVENTORY"
      ? ((await env.DB.prepare("SELECT data FROM inventory").all<{ data: string }>()).results?.map(
          (r) => decode<any>(r.data)
        ) ?? [])
      : await readMany(env, allowed[dataset]);
  const rows = records.filter(
    (record: any) => dataset !== "OVERDUE_LOANS" || record.status === "OVERDUE"
  );
  const columns = rows.length ? Object.keys(rows[0]) : ["id"];
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    columns.map(quote).join(","),
    ...rows.map((row: any) =>
      columns
        .map((column) =>
          quote(typeof row[column] === "object" ? JSON.stringify(row[column]) : row[column])
        )
        .join(",")
    ),
  ].join("\r\n");
  const time = new Date().toISOString().slice(0, 10);
  await audit(env, actor, "EXPORT", "export", `EXPORT_${dataset}`, { rowCount: rows.length }).run();
  return ok({
    filename: `${dataset.toLowerCase()}-${time}.csv`,
    csvContent: csv,
    rowCount: rows.length,
  });
}
