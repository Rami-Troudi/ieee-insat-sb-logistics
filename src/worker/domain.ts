import { DateTime } from "luxon";
import type { Client, InArgs, InStatement, ResultSet } from "@libsql/client";
import type { Env, CurrentUser } from "./env";
import { DomainError } from "./security";
import { escapeHtml, sendEmail } from "./email";

export const DISPLAY_TIME_ZONE = "Africa/Tunis";
const DUPLICATE_SCAN_WINDOW_MS = 3_000;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const opaqueToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

type WriteTransaction = Awaited<ReturnType<Client["transaction"]>>;
export type SqlExecutor = Pick<WriteTransaction, "execute">;
type SqlArg = string | number | boolean | bigint | Uint8Array | null;

async function rows<T>(executor: SqlExecutor, sql: string, args: SqlArg[] = []): Promise<T[]> {
  const result: ResultSet = await executor.execute({ sql, args: args as InArgs } as InStatement);
  return result.rows as unknown as T[];
}

export async function one<T>(executor: SqlExecutor, sql: string, args: SqlArg[] = []) {
  return (await rows<T>(executor, sql, args))[0] ?? null;
}

export async function write<T>(env: Env, operation: (transaction: WriteTransaction) => Promise<T>) {
  const transaction = await env.CLIENT.transaction("write");
  try {
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

function audit(
  tx: SqlExecutor,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  data: unknown = {}
) {
  return tx.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,entity_type,entity_id,action,created_at,data) VALUES(?,?,?,?,?,?,?)",
    args: [id("audit"), actorId, entityType, entityId, action, Date.now(), JSON.stringify(data)],
  });
}

function auditSystem(
  tx: SqlExecutor,
  entityType: string,
  entityId: string,
  action: string,
  data: unknown = {}
) {
  return tx.execute({
    sql: "INSERT INTO audit_events(id,actor_user_id,actor_type,actor_id,entity_type,entity_id,action,created_at,data) VALUES(?,NULL,'SYSTEM','reservation-maintenance',?,?,?,?,?)",
    args: [id("audit"), entityType, entityId, action, Date.now(), JSON.stringify(data)],
  });
}

async function notify(
  tx: SqlExecutor,
  userId: string,
  type: string,
  title: string,
  message: string,
  reservationId: string | null = null
) {
  const notifId = id("notification");
  const now = Date.now();
  await tx.execute({
    sql: "INSERT INTO notifications(id,user_id,type,title,message,reservation_id,created_at) VALUES(?,?,?,?,?,?,?)",
    args: [notifId, userId, type, title, message, reservationId, now],
  });
  const emailEligible = [
    "RESERVATION_APPROVED",
    "RESERVATION_DECLINED",
    "RETURN_DUE_SOON",
    "RETURN_OVERDUE",
    "PICKUP_EXPIRED",
  ];
  if (emailEligible.includes(type)) {
    await tx.execute({
      sql: "INSERT OR IGNORE INTO notification_emails(notification_id,status,attempts,next_attempt_at) VALUES(?,'PENDING',0,0)",
      args: [notifId],
    });
  }
}

async function notifyBoard(
  tx: SqlExecutor,
  type: string,
  title: string,
  message: string,
  reservationId: string
) {
  const boardUsers = await rows<{ id: string }>(
    tx,
    "SELECT id FROM user WHERE role IN ('BOARD','SUPERADMIN')"
  );
  for (const user of boardUsers) await notify(tx, user.id, type, title, message, reservationId);
}

interface AvailableAsset {
  id: string;
  asset_code: string;
  serial_number: string | null;
  state: "AVAILABLE" | "RESERVED";
}

export async function findAvailableAssets(
  executor: SqlExecutor,
  equipmentItemId: string,
  pickupAt: number,
  returnAt: number
): Promise<AvailableAsset[]> {
  return rows<AvailableAsset>(
    executor,
    `SELECT a.id,a.asset_code,a.serial_number,a.state
       FROM assets a
      WHERE a.equipment_item_id=? AND a.active=1
        AND a.state NOT IN ('BORROWED','OUT_OF_SERVICE','RETIRED')
        AND NOT EXISTS (
          SELECT 1
            FROM reservation_assets ra
            INNER JOIN reservations r ON r.id=ra.reservation_id
           WHERE ra.asset_id=a.id
             AND (ra.state='BORROWED' OR (ra.state='RESERVED' AND r.status='APPROVED'
               AND r.pickup_at < ? AND ? < r.return_at))
        )
      ORDER BY a.asset_code ASC`,
    [equipmentItemId, returnAt, pickupAt]
  );
}

export async function availableQuantity(
  tx: SqlExecutor,
  equipmentId: string,
  pickupAt: number,
  returnAt: number,
  excludeReservationId = ""
) {
  const capacity = await one<{ count: number }>(
    tx,
    "SELECT COUNT(*) AS count FROM assets a JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.equipment_item_id=? AND a.active=1 AND e.active=1 AND a.state NOT IN ('OUT_OF_SERVICE','RETIRED')",
    [equipmentId]
  );
  const loans = await rows<{
    id: string;
    pickup_at: number;
    return_at: number;
    quantity: number;
    returned: number;
    borrowed: number;
  }>(
    tx,
    "SELECT r.id,r.pickup_at,r.return_at,l.quantity,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='RETURNED') AS returned,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED') AS borrowed FROM reservations r JOIN reservation_lines l ON l.reservation_id=r.id WHERE l.equipment_item_id=? AND r.id<>? AND (r.status='APPROVED' OR EXISTS (SELECT 1 FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED'))",
    [equipmentId, excludeReservationId]
  );
  const events: Array<{ time: number; delta: number }> = [];
  for (const loan of loans) {
    const overlaps = Number(loan.pickup_at) < returnAt && pickupAt < Number(loan.return_at);
    const held = overlaps
      ? Math.max(Number(loan.borrowed), Number(loan.quantity) - Number(loan.returned))
      : Number(loan.borrowed);
    if (!held) continue;
    events.push({
      time: overlaps ? Math.max(pickupAt, Number(loan.pickup_at)) : pickupAt,
      delta: held,
    });
    events.push({
      time: overlaps ? Math.min(returnAt, Number(loan.return_at)) : returnAt,
      delta: -held,
    });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let used = 0,
    peak = 0;
  for (const event of events) {
    used += event.delta;
    peak = Math.max(peak, used);
  }
  return Math.max(0, Number(capacity?.count ?? 0) - peak);
}

export async function assertCanReduceCapacity(
  tx: SqlExecutor,
  equipmentItemId: string,
  reductionCount: number,
  actionDescription: string
) {
  if (reductionCount <= 0) return;

  const currentCapacityRow = await one<{ count: number }>(
    tx,
    "SELECT COUNT(*) AS count FROM assets a JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.equipment_item_id=? AND a.active=1 AND e.active=1 AND a.state NOT IN ('OUT_OF_SERVICE','RETIRED')",
    [equipmentItemId]
  );
  const currentCapacity = Number(currentCapacityRow?.count ?? 0);
  const newCapacity = Math.max(0, currentCapacity - reductionCount);

  const loans = await rows<{
    id: string;
    pickup_at: number;
    return_at: number;
    quantity: number;
    returned: number;
    borrowed: number;
  }>(
    tx,
    "SELECT r.id, r.pickup_at, r.return_at, l.quantity, " +
      "(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='RETURNED') AS returned, " +
      "(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED') AS borrowed " +
      "FROM reservations r " +
      "JOIN reservation_lines l ON l.reservation_id=r.id " +
      "WHERE l.equipment_item_id=? AND (r.status='APPROVED' OR EXISTS (SELECT 1 FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.state='BORROWED'))",
    [equipmentItemId]
  );

  const now = Date.now();
  const events: Array<{ time: number; delta: number }> = [];
  for (const loan of loans) {
    const returnAt = Number(loan.return_at);
    if (returnAt <= now && Number(loan.borrowed) === 0) continue;
    const held = Math.max(Number(loan.borrowed), Number(loan.quantity) - Number(loan.returned));
    if (held <= 0) continue;
    events.push({ time: Number(loan.pickup_at), delta: held });
    events.push({ time: returnAt, delta: -held });
  }

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let used = 0;
  let peak = 0;
  for (const event of events) {
    used += event.delta;
    peak = Math.max(peak, used);
  }

  if (newCapacity < peak) {
    throw new DomainError(
      409,
      "RESERVATION_CONFLICT",
      `Cannot ${actionDescription} because an approved reservation requires ${peak} units during this period and only ${newCapacity} usable units would remain.`
    );
  }
}

async function checkQuantities(
  tx: SqlExecutor,
  reservationId: string,
  pickupAt: number,
  returnAt: number
) {
  const lines = await rows<{ equipment_item_id: string; quantity: number }>(
    tx,
    "SELECT equipment_item_id,quantity FROM reservation_lines WHERE reservation_id=?",
    [reservationId]
  );
  for (const line of lines) {
    if (
      (await availableQuantity(tx, line.equipment_item_id, pickupAt, returnAt, reservationId)) <
      Number(line.quantity)
    )
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "The requested equipment quantity is no longer available for this window."
      );
  }
}

export interface CatalogueItem {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  available: boolean;
}

export async function listCatalogue(env: Env, pickupAt: number, returnAt: number) {
  const items = await rows<Omit<CatalogueItem, "available">>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT id,name,description,category,image_url AS imageUrl FROM equipment_items WHERE active=1 ORDER BY category,name"
  );
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      available:
        (await availableQuantity(
          env.CLIENT as unknown as SqlExecutor,
          item.id,
          pickupAt,
          returnAt
        )) > 0,
    }))
  );
}

interface ReservationRow {
  id: string;
  requested_by_user_id: string;
  requester_name: string;
  requester_email: string;
  borrower_type: "PERSON" | "CHAPTER";
  borrower_user_id: string | null;
  chapter_id: string | null;
  borrower_name: string | null;
  chapter_name: string | null;
  pickup_at: number;
  return_at: number;
  note: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "COMPLETED";
  created_at: number;
}

interface ReservationLineRow {
  id: string;
  equipment_item_id: string;
  equipment_name: string;
  quantity: number;
  asset_id: string | null;
  asset_code: string | null;
  asset_state: "RESERVED" | "BORROWED" | "RETURNED" | "RELEASED" | null;
  asset_state_now: string | null;
}

export interface ReservationDTO {
  id: string;
  requestedBy: { id: string; name: string; email: string };
  borrower: { type: "PERSON" | "CHAPTER"; id: string; name: string };
  items: Array<{
    lineId: string;
    equipmentItemId: string;
    name: string;
    quantity: number;
    assignedAssets?: Array<{ id: string; assetCode: string; state: string }>;
  }>;
  pickupAt: string;
  returnAt: string;
  note: string | null;
  status: ReservationRow["status"];
  derivedStatus:
    | "PENDING"
    | "APPROVED"
    | "BORROWED"
    | "PARTIALLY_RETURNED"
    | "RETURNED"
    | "OVERDUE"
    | "DECLINED"
    | "CANCELLED";
  collectedCount: number;
  returnedCount: number;
  totalQuantity: number;
  createdAt: string;
}

export async function finalizeReservationIfFinished(
  tx: SqlExecutor,
  reservationId: string,
  now = Date.now()
): Promise<boolean> {
  const reservation = await one<{
    id: string;
    status: string;
    return_at: number;
    total_requested: number;
    borrowed_count: number;
    returned_count: number;
    collected_count: number;
  }>(
    tx,
    `SELECT r.id, r.status, r.return_at,
      COALESCE((SELECT SUM(quantity) FROM reservation_lines WHERE reservation_id = r.id), 0) AS total_requested,
      COALESCE((SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = r.id AND state = 'BORROWED'), 0) AS borrowed_count,
      COALESCE((SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = r.id AND state = 'RETURNED'), 0) AS returned_count,
      COALESCE((SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = r.id AND state NOT IN ('RESERVED', 'RELEASED')), 0) AS collected_count
     FROM reservations r
     WHERE r.id = ?`,
    [reservationId]
  );

  if (!reservation || reservation.status !== "APPROVED") {
    return false;
  }

  const returnAt = Number(reservation.return_at);
  const borrowedCount = Number(reservation.borrowed_count);
  const returnedCount = Number(reservation.returned_count);
  const totalRequested = Number(reservation.total_requested);
  const collectedCount = Number(reservation.collected_count);

  let shouldComplete = false;

  // 1. If all requested units were collected and all are returned -> COMPLETED immediately
  if (totalRequested > 0 && collectedCount === totalRequested && returnedCount === totalRequested) {
    shouldComplete = true;
  } else if (now >= returnAt && borrowedCount === 0) {
    await releaseUncollectedAssets(tx, reservationId, now);
    shouldComplete = true;
  }

  if (shouldComplete) {
    await tx.execute({
      sql: "UPDATE reservations SET status='COMPLETED', updated_at=? WHERE id=? AND status='APPROVED'",
      args: [now, reservationId],
    });
    return true;
  }

  return false;
}

async function releaseUncollectedAssets(tx: SqlExecutor, reservationId: string, now: number) {
  const reserved = await rows<{ asset_id: string }>(
    tx,
    "SELECT asset_id FROM reservation_assets WHERE reservation_id=? AND state='RESERVED'",
    [reservationId]
  );
  await tx.execute({
    sql: "UPDATE reservation_assets SET state='RELEASED',updated_at=? WHERE reservation_id=? AND state='RESERVED'",
    args: [now, reservationId],
  });
  for (const { asset_id } of reserved) {
    const other = await one<{ count: number }>(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE asset_id=? AND state='RESERVED'",
      [asset_id]
    );
    if (!Number(other?.count ?? 0))
      await tx.execute({
        sql: "UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id=? AND state='RESERVED'",
        args: [now, asset_id],
      });
  }
}

async function expireUncollectedReservationsTx(tx: SqlExecutor, now: number) {
  const cutoff = now - 30 * 60_000;
  const candidates = await rows<{
    id: string;
    requested_by_user_id: string;
    status: string;
  }>(
    tx,
    `SELECT r.id, r.requested_by_user_id, r.status
     FROM reservations r
     WHERE r.status IN ('PENDING', 'APPROVED')
       AND r.pickup_at <= ?
       AND (
         SELECT COUNT(*)
         FROM reservation_assets ra
         WHERE ra.reservation_id = r.id AND ra.actual_pickup_at IS NOT NULL
       ) = 0`,
    [cutoff]
  );

  let expiredCount = 0;
  for (const r of candidates) {
    await tx.execute({
      sql: "UPDATE reservations SET status = 'CANCELLED', pickup_closed_at = ?, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'APPROVED')",
      args: [now, now, r.id],
    });
    await tx.execute({
      sql: "UPDATE reservation_assets SET state = 'RELEASED', updated_at = ? WHERE reservation_id = ? AND state = 'RESERVED'",
      args: [now, r.id],
    });
    await notify(
      tx,
      r.requested_by_user_id,
      "PICKUP_EXPIRED",
      "Pickup window expired",
      "Your reservation was cancelled because equipment was not collected within 30 minutes of the scheduled pickup.",
      r.id
    );
    await auditSystem(tx, "RESERVATION", r.id, "RESERVATION_CANCELLED", {
      reason: "MISSED_PICKUP_30_MIN",
      pickupClosedAt: now,
    });
    expiredCount++;
  }
  return expiredCount;
}

export async function expireUncollectedReservations(env: Env, now = Date.now()): Promise<number> {
  return write(env, (tx) => expireUncollectedReservationsTx(tx, now));
}

export async function reconcileExpiredReservations(env: Env, now = Date.now()) {
  await write(env, async (tx) => {
    await expireUncollectedReservationsTx(tx, now);
    const expired = await rows<{ id: string }>(
      tx,
      "SELECT id FROM reservations WHERE status='APPROVED' AND return_at<=? AND (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id=reservations.id AND state='RESERVED')>0",
      [now]
    );
    for (const { id: reservationId } of expired)
      await releaseUncollectedAssets(tx, reservationId, now);

    // 1. Expired approved reservations with 0 currently borrowed units -> COMPLETED
    await tx.execute({
      sql: `UPDATE reservations
            SET status = 'COMPLETED', updated_at = ?
            WHERE status = 'APPROVED'
              AND return_at <= ?
              AND (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = reservations.id AND state = 'BORROWED') = 0
              AND (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = reservations.id AND state = 'RESERVED') = 0`,
      args: [now, now],
    });

    // 2. Approved reservations where all requested units are collected and returned -> COMPLETED
    await tx.execute({
      sql: `UPDATE reservations
            SET status = 'COMPLETED', updated_at = ?
            WHERE status = 'APPROVED'
              AND (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = reservations.id AND state = 'BORROWED') = 0
              AND (SELECT COALESCE(SUM(quantity), 0) FROM reservation_lines WHERE reservation_id = reservations.id) > 0
              AND (SELECT COALESCE(SUM(quantity), 0) FROM reservation_lines WHERE reservation_id = reservations.id) = (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = reservations.id AND state = 'RETURNED')
              AND (SELECT COUNT(*) FROM reservation_assets WHERE reservation_id = reservations.id AND state NOT IN ('RESERVED', 'RELEASED')) = (SELECT COALESCE(SUM(quantity), 0) FROM reservation_lines WHERE reservation_id = reservations.id)`,
      args: [now],
    });
  });
}

export async function getReservation(
  env: Env,
  reservationId: string,
  includeAssets = false
): Promise<ReservationDTO | null> {
  const executor = env.CLIENT as unknown as SqlExecutor;
  const reservation = await one<ReservationRow>(
    executor,
    `SELECT r.id,r.requested_by_user_id,u.name AS requester_name,u.email AS requester_email,
            r.borrower_type,r.borrower_user_id,r.chapter_id,bu.name AS borrower_name,ch.name AS chapter_name,
            r.pickup_at,r.return_at,r.note,r.status,r.created_at
       FROM reservations r
       INNER JOIN user u ON u.id=r.requested_by_user_id
       LEFT JOIN user bu ON bu.id=r.borrower_user_id
       LEFT JOIN chapters ch ON ch.id=r.chapter_id
      WHERE r.id=?`,
    [reservationId]
  );
  if (!reservation) return null;

  if (reservation.status === "APPROVED") {
    const finalized = await finalizeReservationIfFinished(executor, reservationId);
    if (finalized) {
      reservation.status = "COMPLETED";
    }
  }

  const lineRows = await rows<ReservationLineRow>(
    executor,
    `SELECT l.id,l.equipment_item_id,e.name AS equipment_name,l.quantity,
            ra.asset_id,a.asset_code,ra.state AS asset_state,a.state AS asset_state_now
       FROM reservation_lines l
       INNER JOIN equipment_items e ON e.id=l.equipment_item_id
       LEFT JOIN reservation_assets ra ON ra.reservation_line_id=l.id
       LEFT JOIN assets a ON a.id=ra.asset_id
      WHERE l.reservation_id=?
      ORDER BY e.name,a.asset_code`,
    [reservationId]
  );
  const grouped = new Map<string, ReservationDTO["items"][number]>();
  const assignmentStates: string[] = [];
  for (const line of lineRows) {
    let item = grouped.get(line.id);
    if (!item) {
      item = {
        lineId: line.id,
        equipmentItemId: line.equipment_item_id,
        name: line.equipment_name,
        quantity: Number(line.quantity),
        ...(includeAssets ? { assignedAssets: [] } : {}),
      };
      grouped.set(line.id, item);
    }
    if (line.asset_state) {
      assignmentStates.push(line.asset_state);
      if (includeAssets && line.asset_id && line.asset_code) {
        item.assignedAssets!.push({
          id: line.asset_id,
          assetCode: line.asset_code,
          state: line.asset_state,
        });
      }
    }
  }

  const now = Date.now();
  const borrowedCount = assignmentStates.filter((state) => state === "BORROWED").length;
  const returnedCount = assignmentStates.filter((state) => state === "RETURNED").length;
  const collectedCount = assignmentStates.filter(
    (state) => state !== "RESERVED" && state !== "RELEASED"
  ).length;
  let derivedStatus: ReservationDTO["derivedStatus"] =
    reservation.status === "COMPLETED" ? "RETURNED" : reservation.status;
  if (borrowedCount > 0 && now > Number(reservation.return_at)) {
    derivedStatus = "OVERDUE";
  } else if (borrowedCount > 0 && returnedCount > 0) {
    derivedStatus = "PARTIALLY_RETURNED";
  } else if (borrowedCount > 0) {
    derivedStatus = "BORROWED";
  } else if (
    reservation.status === "APPROVED" &&
    now >= Number(reservation.return_at) &&
    borrowedCount === 0
  ) {
    derivedStatus = "RETURNED";
  } else if (reservation.status === "COMPLETED") {
    derivedStatus = "RETURNED";
  }

  return {
    id: reservation.id,
    requestedBy: {
      id: reservation.requested_by_user_id,
      name: reservation.requester_name,
      email: reservation.requester_email,
    },
    borrower: {
      type: reservation.borrower_type,
      id:
        reservation.borrower_type === "PERSON"
          ? reservation.borrower_user_id!
          : reservation.chapter_id!,
      name:
        reservation.borrower_type === "PERSON"
          ? (reservation.borrower_name ?? reservation.requester_name)
          : (reservation.chapter_name ?? "Inactive chapter"),
    },
    items: [...grouped.values()],
    pickupAt: new Date(Number(reservation.pickup_at)).toISOString(),
    returnAt: new Date(Number(reservation.return_at)).toISOString(),
    note: reservation.note,
    status: reservation.status,
    derivedStatus,
    collectedCount,
    returnedCount,
    totalQuantity: [...grouped.values()].reduce((sum, item) => sum + item.quantity, 0),
    createdAt: new Date(Number(reservation.created_at)).toISOString(),
  };
}

export async function listReservations(env: Env, ownerId: string) {
  await reconcileExpiredReservations(env);
  const ids = await rows<{ id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT id FROM reservations WHERE requested_by_user_id=? ORDER BY pickup_at DESC LIMIT 200",
    [ownerId]
  );
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId)));
}

export async function listBoardReservations(
  env: Env,
  options: { offset?: number; limit?: number; start?: number; end?: number } = {}
) {
  await reconcileExpiredReservations(env);
  const limit = Math.min(100, Math.max(1, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  let sql = "SELECT id FROM reservations";
  const args: (string | number)[] = [];

  if (options.start !== undefined && options.end !== undefined) {
    sql += " WHERE pickup_at < ? AND ? < return_at";
    args.push(options.end, options.start);
  }

  sql +=
    " ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, pickup_at ASC LIMIT ? OFFSET ?";
  args.push(limit, offset);

  const ids = await rows<{ id: string }>(env.CLIENT as unknown as SqlExecutor, sql, args);
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId, true)));
}

export interface CreateReservationInput {
  pickupAt: number;
  returnAt: number;
  note?: string;
  items: Array<{ equipmentItemId: string; quantity: number }>;
}

function validateWindow(pickupAt: number, returnAt: number, allowStarted = false) {
  if (!Number.isFinite(pickupAt) || !Number.isFinite(returnAt) || pickupAt >= returnAt) {
    throw new DomainError(
      400,
      "INVALID_TIME_RANGE",
      "Choose a pickup time before the return time."
    );
  }
  if (!allowStarted && pickupAt < Date.now()) {
    throw new DomainError(400, "INVALID_TIME_RANGE", "Pickup cannot be in the past.");
  }
}

export async function createReservation(
  env: Env,
  actor: CurrentUser,
  input: CreateReservationInput
) {
  validateWindow(input.pickupAt, input.returnAt);
  if (
    !input.items.length ||
    input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)
  ) {
    throw new DomainError(400, "VALIDATION", "Add at least one item with a positive quantity.");
  }
  const duplicateItems = new Set(input.items.map((item) => item.equipmentItemId));
  if (duplicateItems.size !== input.items.length) {
    throw new DomainError(
      400,
      "VALIDATION",
      "Combine duplicate equipment lines into one quantity."
    );
  }

  const reservationId = id("reservation");
  await write(env, async (tx) => {
    for (const line of input.items) {
      const equipment = await one<{ id: string }>(
        tx,
        "SELECT id FROM equipment_items WHERE id=? AND active=1",
        [line.equipmentItemId]
      );
      if (!equipment)
        throw new DomainError(
          400,
          "VALIDATION",
          "One of the selected equipment items is unavailable."
        );
      const candidates = await availableQuantity(
        tx,
        line.equipmentItemId,
        input.pickupAt,
        input.returnAt
      );
      if (candidates < line.quantity) {
        throw new DomainError(
          409,
          "NOT_AVAILABLE",
          "There is not enough equipment available for that time range."
        );
      }
    }

    const createdAt = Date.now();
    await tx.execute({
      sql: `INSERT INTO reservations(id,requested_by_user_id,borrower_type,borrower_user_id,chapter_id,pickup_at,return_at,note,status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?, 'PENDING',?,?)`,
      args: [
        reservationId,
        actor.id,
        "PERSON",
        actor.id,
        null,
        input.pickupAt,
        input.returnAt,
        input.note?.trim() || null,
        createdAt,
        createdAt,
      ],
    });
    for (const line of input.items) {
      await tx.execute({
        sql: "INSERT INTO reservation_lines(id,reservation_id,equipment_item_id,quantity) VALUES(?,?,?,?)",
        args: [id("line"), reservationId, line.equipmentItemId, line.quantity],
      });
    }
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_CREATED", {
      itemCount: input.items.length,
    });
    await notify(
      tx,
      actor.id,
      "RESERVATION_SUBMITTED",
      "Reservation request submitted",
      "Your request is waiting for Board review. We will remind you before borrowed equipment is due back.",
      reservationId
    );
    await notifyBoard(
      tx,
      "NEW_RESERVATION",
      "New reservation",
      `${actor.name} submitted a reservation.`,
      reservationId
    );
  });
  return getReservation(env, reservationId);
}

export async function refreshReturnNotificationsForUser(
  env: Env,
  userId: string,
  now = Date.now()
) {
  return write(env, async (tx) => {
    const activeLoans = await rows<{ id: string; return_at: number; borrowed_count: number }>(
      tx,
      "SELECT r.id,r.return_at,COUNT(ra.id) AS borrowed_count " +
        "FROM reservations r " +
        "INNER JOIN reservation_assets ra ON ra.reservation_id=r.id " +
        "WHERE r.requested_by_user_id=? AND r.status='APPROVED' AND ra.state='BORROWED' " +
        "GROUP BY r.id,r.return_at",
      [userId]
    );
    const todayStart = tunisDayRange(now).start;
    let created = 0;

    for (const loan of activeLoans) {
      const returnAt = Number(loan.return_at);
      const dueLabel = DateTime.fromMillis(returnAt, { zone: DISPLAY_TIME_ZONE }).toFormat(
        "ccc, d LLL 'at' HH:mm"
      );
      if (returnAt > now && returnAt <= now + 60 * 60_000) {
        const priorReminder = await one<{ id: string }>(
          tx,
          "SELECT id FROM notifications WHERE user_id=? AND reservation_id=? AND type='RETURN_DUE_SOON' AND message LIKE ? LIMIT 1",
          [userId, loan.id, `%${dueLabel}%`]
        );
        if (!priorReminder) {
          await notify(
            tx,
            userId,
            "RETURN_DUE_SOON",
            "Equipment due back soon",
            "Your borrowed equipment is due back by " +
              dueLabel +
              ". Please return it to the Board.",
            loan.id
          );
          created++;
        }
      } else if (returnAt <= now) {
        const priorOverdue = await one<{ id: string }>(
          tx,
          "SELECT id FROM notifications WHERE user_id=? AND reservation_id=? AND type='RETURN_OVERDUE' AND created_at>=? LIMIT 1",
          [userId, loan.id, todayStart]
        );
        if (!priorOverdue) {
          await notify(
            tx,
            userId,
            "RETURN_OVERDUE",
            "Equipment return overdue",
            "The return time (" +
              dueLabel +
              ") has passed. Please return the borrowed equipment to the Board as soon as possible.",
            loan.id
          );
          created++;
        }
      }
    }
    return created;
  });
}

export async function refreshAllReturnNotifications(env: Env, now = Date.now()) {
  await reconcileExpiredReservations(env, now);
  const borrowers = await rows<{ user_id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT DISTINCT r.requested_by_user_id AS user_id " +
      "FROM reservations r " +
      "INNER JOIN reservation_assets ra ON ra.reservation_id=r.id " +
      "WHERE r.status='APPROVED' AND ra.state='BORROWED'"
  );
  let created = 0;
  for (const borrower of borrowers) {
    created += await refreshReturnNotificationsForUser(env, borrower.user_id, now);
  }
  return { borrowersChecked: borrowers.length, notificationsCreated: created };
}

export async function approveReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string,
  _assignments?: Record<string, string[]>
) {
  await write(env, async (tx) => {
    const reservation = await one<{ status: string; pickup_at: number; return_at: number }>(
      tx,
      "SELECT status,pickup_at,return_at FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "PENDING")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only a pending reservation can be approved."
      );
    await checkQuantities(
      tx,
      reservationId,
      Number(reservation.pickup_at),
      Number(reservation.return_at)
    );
    const timestamp = Date.now();
    await tx.execute({
      sql: "UPDATE reservations SET status='APPROVED',approved_by_user_id=?,updated_at=? WHERE id=? AND status='PENDING'",
      args: [actor.id, timestamp, reservationId],
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_APPROVED", {
      allocation: "QUANTITY_ONLY",
    });
    const requester = await one<{ requested_by_user_id: string }>(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (requester)
      await notify(
        tx,
        requester.requested_by_user_id,
        "RESERVATION_APPROVED",
        "Reservation approved",
        "Your equipment reservation has been approved. Open your reservations and select Show Handover QR. Present it to the Board for pickup and return.",
        reservationId
      );
  });
  return getReservation(env, reservationId, true);
}

export async function declineReservation(env: Env, actor: CurrentUser, reservationId: string) {
  await write(env, async (tx) => {
    const reservation = await one<{ status: string; requested_by_user_id: string }>(
      tx,
      "SELECT status,requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "PENDING")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only a pending reservation can be declined."
      );
    await tx.execute({
      sql: "UPDATE reservations SET status='DECLINED',updated_at=? WHERE id=?",
      args: [Date.now(), reservationId],
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_DECLINED");
    await notify(
      tx,
      reservation.requested_by_user_id,
      "RESERVATION_DECLINED",
      "Reservation declined",
      "The Board declined your equipment reservation.",
      reservationId
    );
  });
  return getReservation(env, reservationId, true);
}

export async function cancelReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string,
  isBoard = false
) {
  await write(env, async (tx) => {
    const reservation = await one<{
      status: string;
      pickup_at: number;
      requested_by_user_id: string;
    }>(tx, "SELECT status,pickup_at,requested_by_user_id FROM reservations WHERE id=?", [
      reservationId,
    ]);
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (!isBoard && reservation.requested_by_user_id !== actor.id)
      throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (
      !["PENDING", "APPROVED"].includes(reservation.status) ||
      Number(reservation.pickup_at) <= Date.now()
    ) {
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "This reservation can no longer be cancelled."
      );
    }
    const borrowed = await one<{ count: number }>(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND state='BORROWED'",
      [reservationId]
    );
    if (Number(borrowed?.count ?? 0) > 0)
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "A reservation with checked-out equipment cannot be cancelled."
      );
    await tx.execute({
      sql: "UPDATE reservation_assets SET state='RELEASED',updated_at=? WHERE reservation_id=? AND state='RESERVED'",
      args: [Date.now(), reservationId],
    });
    await tx.execute({
      sql: "UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id IN (SELECT asset_id FROM reservation_assets WHERE reservation_id=? AND state='RELEASED') AND state='RESERVED'",
      args: [Date.now(), reservationId],
    });
    await tx.execute({
      sql: "UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=?",
      args: [Date.now(), reservationId],
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_CANCELLED");
    await notify(
      tx,
      reservation.requested_by_user_id,
      "RESERVATION_CANCELLED",
      "Reservation cancelled",
      "Your equipment reservation was cancelled.",
      reservationId
    );
  });
  return getReservation(env, reservationId, isBoard);
}

export async function forceDeleteReservation(env: Env, actor: CurrentUser, reservationId: string) {
  return await write(env, async (tx) => {
    const reservation = await one<{
      id: string;
      status: string;
      requested_by_user_id: string;
    }>(tx, "SELECT id,status,requested_by_user_id FROM reservations WHERE id=?", [reservationId]);
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");

    const handover = await one<{ count: number }>(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND (actual_pickup_at IS NOT NULL OR state IN ('BORROWED', 'RETURNED'))",
      [reservationId]
    );
    if (Number(handover?.count ?? 0) > 0) {
      throw new DomainError(
        409,
        "HANDOVER_EXISTS",
        "Cannot force-delete a reservation that has physical handover history."
      );
    }

    // Release any unused physical assets
    await tx.execute({
      sql: `UPDATE assets SET state='AVAILABLE', updated_at=?
            WHERE id IN (
              SELECT asset_id FROM reservation_assets
              WHERE reservation_id=? AND state='RESERVED'
            ) AND state='RESERVED'`,
      args: [Date.now(), reservationId],
    });

    // Delete reservation assets
    await tx.execute({
      sql: "DELETE FROM reservation_assets WHERE reservation_id=?",
      args: [reservationId],
    });

    // Delete reservation lines
    await tx.execute({
      sql: "DELETE FROM reservation_lines WHERE reservation_id=?",
      args: [reservationId],
    });

    // Nullify reservation_id in notifications
    await tx.execute({
      sql: "UPDATE notifications SET reservation_id=NULL WHERE reservation_id=?",
      args: [reservationId],
    });

    // Delete the reservation itself
    await tx.execute({
      sql: "DELETE FROM reservations WHERE id=?",
      args: [reservationId],
    });

    // Audit log
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_FORCE_DELETED", {
      previousStatus: reservation.status,
    });

    // Notify requester if not the actor
    if (reservation.requested_by_user_id !== actor.id) {
      await notify(
        tx,
        reservation.requested_by_user_id,
        "RESERVATION_DELETED",
        "Reservation request removed",
        "Your equipment reservation request was removed by the Board.",
        null
      );
    }

    return { ok: true, id: reservationId };
  });
}

async function assignApprovedReservation(
  tx: WriteTransaction,
  actor: CurrentUser,
  reservationId: string,
  pickupAt: number,
  returnAt: number,
  _assignments?: Record<string, string[]>
) {
  await checkQuantities(tx, reservationId, pickupAt, returnAt);
  await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_RESCHEDULED", {
    pickupAt,
    returnAt,
    allocation: "QUANTITY_ONLY",
  });
}

export async function rescheduleReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string,
  pickupAt: number,
  returnAt: number,
  assignments?: Record<string, string[]>
) {
  validateWindow(pickupAt, returnAt);
  await write(env, async (tx) => {
    const reservation = await one<{ status: string }>(
      tx,
      "SELECT status FROM reservations WHERE id=?",
      [reservationId]
    );
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
    if (reservation.status !== "APPROVED")
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Only an approved reservation can be rescheduled."
      );
    const pickedUp = await one<{ count: number }>(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND actual_pickup_at IS NOT NULL",
      [reservationId]
    );
    if (Number(pickedUp?.count ?? 0) > 0) {
      throw new DomainError(
        409,
        "RESERVATION_LOCKED",
        "Reservations cannot be rescheduled after equipment has been picked up."
      );
    }
    const borrowed = await one<{ count: number }>(
      tx,
      "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND state='BORROWED'",
      [reservationId]
    );
    if (Number(borrowed?.count ?? 0) > 0)
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Return checked-out equipment before changing the reservation time."
      );
    await tx.execute({
      sql: "DELETE FROM notifications WHERE reservation_id=? AND type='RETURN_DUE_SOON'",
      args: [reservationId],
    });
    await tx.execute({
      sql: "UPDATE reservation_assets SET state='RELEASED',updated_at=? WHERE reservation_id=? AND state='RESERVED'",
      args: [Date.now(), reservationId],
    });
    await tx.execute({
      sql: "UPDATE assets SET state='AVAILABLE',updated_at=? WHERE id IN (SELECT asset_id FROM reservation_assets WHERE reservation_id=? AND state='RELEASED') AND state='RESERVED'",
      args: [Date.now(), reservationId],
    });
    await tx.execute({
      sql: "UPDATE reservations SET pickup_at=?,return_at=?,updated_at=? WHERE id=?",
      args: [pickupAt, returnAt, Date.now(), reservationId],
    });
    await assignApprovedReservation(tx, actor, reservationId, pickupAt, returnAt, assignments);
    const requester = await one<{ requested_by_user_id: string }>(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    if (requester)
      await notify(
        tx,
        requester.requested_by_user_id,
        "RESERVATION_UPDATED",
        "Reservation time updated",
        "The Board updated your reservation window.",
        reservationId
      );
  });
  return getReservation(env, reservationId, true);
}

export type ScanResult =
  | {
      operation: "CHECKED_OUT" | "RETURNED";
      assetName: string;
      assetCode: string;
      reservationId?: string;
      borrowerName?: string;
      returnAt?: string;
    }
  | {
      code: "RESERVATION_SELECTION_REQUIRED";
      assetName: string;
      assetCode: string;
      reservations: Array<{
        id: string;
        borrowerName: string;
        chapterName?: string | null;
        pickupAt: string;
        returnAt: string;
        quantity: number;
        uncollectedCount: number;
      }>;
    };

async function collectMaterial(
  tx: WriteTransaction,
  actor: CurrentUser,
  reservationId: string,
  assetId: string,
  timestamp: number
) {
  const reservation = await one<{
    status: string;
    pickup_at: number;
    return_at: number;
    requested_by_user_id: string;
    borrower_name: string;
  }>(
    tx,
    "SELECT r.status,r.pickup_at,r.return_at,r.requested_by_user_id,CASE WHEN r.borrower_type='PERSON' THEN u.name ELSE ch.name END AS borrower_name FROM reservations r LEFT JOIN user u ON u.id=r.borrower_user_id LEFT JOIN chapters ch ON ch.id=r.chapter_id WHERE r.id=?",
    [reservationId]
  );
  if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");
  if (reservation.status !== "APPROVED")
    throw new DomainError(
      409,
      "INVALID_CHECKOUT",
      "Only approved reservations can collect equipment."
    );
  if (timestamp < Number(reservation.pickup_at))
    throw new DomainError(409, "TOO_EARLY", "The pickup window has not started yet.");
  if (timestamp >= Number(reservation.return_at))
    throw new DomainError(409, "RESERVATION_EXPIRED", "The reservation window has expired.");
  const asset = await one<{
    equipment_item_id: string;
    state: string;
    active: number;
    equipment_active: number;
  }>(
    tx,
    "SELECT a.equipment_item_id,a.state,a.active,e.active AS equipment_active FROM assets a JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.id=?",
    [assetId]
  );
  if (!asset || !asset.active || !["AVAILABLE", "RESERVED"].includes(asset.state))
    throw new DomainError(409, "ASSET_UNAVAILABLE", "This material is not available for pickup.");
  const existing = await one<{ id: string }>(
    tx,
    "SELECT id FROM reservation_assets WHERE asset_id=? AND (state='BORROWED' OR (reservation_id=? AND actual_pickup_at IS NOT NULL))",
    [assetId, reservationId]
  );
  if (existing)
    throw new DomainError(409, "INVALID_CHECKOUT", "This material has already been collected.");
  const line = await one<{ id: string; quantity: number; collected: number }>(
    tx,
    "SELECT l.id,l.quantity,(SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.actual_pickup_at IS NOT NULL) AS collected FROM reservation_lines l WHERE l.reservation_id=? AND l.equipment_item_id=?",
    [reservationId, asset.equipment_item_id]
  );
  if (!line)
    throw new DomainError(
      409,
      "WRONG_RESERVATION",
      "This equipment type is not part of this reservation."
    );
  if (Number(line.collected) >= Number(line.quantity))
    throw new DomainError(
      409,
      "QUANTITY_REACHED",
      "All requested units of this equipment type have been collected."
    );
  await tx.execute({
    sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,actual_pickup_at,checked_out_by_user_id,created_at,updated_at) VALUES(?,?,?,?,'BORROWED',?,?,?,?)",
    args: [
      id("reservation_asset"),
      reservationId,
      line.id,
      assetId,
      timestamp,
      actor.id,
      timestamp,
      timestamp,
    ],
  });
  await tx.execute({
    sql: "UPDATE assets SET state='BORROWED',last_scan_at=?,updated_at=? WHERE id=?",
    args: [timestamp, timestamp, assetId],
  });
  await audit(tx, actor.id, "ASSET", assetId, "ASSET_CHECKED_OUT", { reservationId });
  return reservation;
}

export async function handoverReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string,
  assetIds: string[] = []
) {
  if (!assetIds.length || new Set(assetIds).size !== assetIds.length)
    throw new DomainError(400, "VALIDATION", "Select the material labels actually handed over.");
  return write(env, async (tx) => {
    const timestamp = Date.now();
    for (const assetId of assetIds)
      await collectMaterial(tx, actor, reservationId, assetId, timestamp);
    const reservation = await one<{ requested_by_user_id: string }>(
      tx,
      "SELECT requested_by_user_id FROM reservations WHERE id=?",
      [reservationId]
    );
    await notify(
      tx,
      reservation!.requested_by_user_id,
      "ASSET_CHECKED_OUT",
      "Equipment handed over",
      "Equipment collection has been recorded. Please return it by the reservation deadline.",
      reservationId
    );
    return { ok: true, handedOverCount: assetIds.length };
  });
}

export async function scanAsset(
  env: Env,
  actor: CurrentUser,
  qrToken: string,
  idempotencyKey: string,
  reservationId?: string,
  operation?: "CHECKED_OUT" | "RETURNED"
): Promise<ScanResult> {
  if (!/^[a-f0-9]{64}$/i.test(qrToken))
    throw new DomainError(400, "INVALID_ASSET", "This QR code is not valid.");
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(idempotencyKey))
    throw new DomainError(400, "VALIDATION", "A valid scan operation key is required.");
  return write(env, async (tx) => {
    const replay = await one<{ response: string }>(
      tx,
      "SELECT response FROM idempotency_keys WHERE actor_id=? AND operation='ASSET_SCAN' AND key=?",
      [actor.id, idempotencyKey]
    );
    if (replay) return JSON.parse(replay.response) as ScanResult;

    const asset = await one<{
      id: string;
      asset_code: string;
      state: string;
      active: number;
      last_scan_at: number | null;
      equipment_name: string;
      equipment_item_id: string;
    }>(
      tx,
      "SELECT a.id,a.asset_code,a.state,a.active,a.last_scan_at,a.equipment_item_id,e.name AS equipment_name FROM assets a INNER JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.qr_token=?",
      [qrToken]
    );
    if (!asset) throw new DomainError(404, "INVALID_ASSET", "No equipment matches this QR code.");
    if (reservationId && operation === "RETURNED") {
      const assignment = await one<{ id: string }>(
        tx,
        "SELECT id FROM reservation_assets WHERE reservation_id=? AND asset_id=? AND state='BORROWED'",
        [reservationId, asset.id]
      );
      if (!assignment)
        throw new DomainError(
          409,
          "INVALID_RETURN",
          "This material is not awaiting return for this reservation."
        );
    }
    if (operation === "CHECKED_OUT" && asset.state === "BORROWED")
      throw new DomainError(409, "INVALID_CHECKOUT", "This material is already borrowed.");
    if (!asset.active || asset.state === "RETIRED")
      throw new DomainError(409, "INVALID_ASSET", "This asset has been retired.");
    if (asset.state === "OUT_OF_SERVICE")
      throw new DomainError(409, "OUT_OF_SERVICE", "This asset is out of service.");
    const timestamp = Date.now();
    if (
      asset.last_scan_at !== null &&
      timestamp - Number(asset.last_scan_at) < DUPLICATE_SCAN_WINDOW_MS
    ) {
      throw new DomainError(
        409,
        "DUPLICATE_SCAN",
        "This QR was just processed. Wait a moment before scanning it again."
      );
    }

    let result: ScanResult;
    if (asset.state === "BORROWED") {
      const assignment = await one<{
        id: string;
        reservation_id: string;
        return_at: number;
        requested_by_user_id: string;
        borrower_name: string;
      }>(
        tx,
        `SELECT ra.id,ra.reservation_id,r.return_at,r.requested_by_user_id,
                CASE WHEN r.borrower_type='PERSON' THEN bu.name ELSE ch.name END AS borrower_name
           FROM reservation_assets ra
           INNER JOIN reservations r ON r.id=ra.reservation_id
           LEFT JOIN user bu ON bu.id=r.borrower_user_id
           LEFT JOIN chapters ch ON ch.id=r.chapter_id
          WHERE ra.asset_id=? AND ra.state='BORROWED' ORDER BY ra.updated_at DESC LIMIT 1`,
        [asset.id]
      );
      if (!assignment)
        throw new DomainError(409, "ALREADY_RETURNED", "This asset has no active checkout.");
      await tx.execute({
        sql: "UPDATE reservation_assets SET state='RETURNED',actual_return_at=?,checked_in_by_user_id=?,updated_at=? WHERE id=? AND state='BORROWED'",
        args: [timestamp, actor.id, timestamp, assignment.id],
      });
      await tx.execute({
        sql: "UPDATE assets SET state='AVAILABLE',last_scan_at=?,updated_at=? WHERE id=?",
        args: [timestamp, timestamp, asset.id],
      });
      await finalizeReservationIfFinished(tx, assignment.reservation_id, timestamp);
      await audit(tx, actor.id, "ASSET", asset.id, "ASSET_RETURNED", {
        reservationId: assignment.reservation_id,
      });
      await notify(
        tx,
        assignment.requested_by_user_id,
        "ASSET_RETURNED",
        "Equipment returned",
        `${asset.equipment_name} ${asset.asset_code} was returned.`,
        assignment.reservation_id
      );
      result = {
        operation: "RETURNED",
        assetName: asset.equipment_name,
        assetCode: asset.asset_code,
        reservationId: assignment.reservation_id,
      };
    } else {
      if (operation === "RETURNED") {
        throw new DomainError(409, "ALREADY_RETURNED", "This asset has no active checkout.");
      }
      const equipment = await one<{ active: number }>(
        tx,
        "SELECT active FROM equipment_items WHERE id=?",
        [asset.equipment_item_id]
      );
      if (!equipment || !equipment.active) {
        throw new DomainError(409, "ASSET_UNAVAILABLE", "This equipment is currently inactive.");
      }

      let targetReservationId = reservationId;
      if (!targetReservationId) {
        const eligible = await rows<{
          id: string;
          pickup_at: number;
          return_at: number;
          quantity: number;
          collected: number;
          borrower_name: string;
          chapter_name: string | null;
        }>(
          tx,
          `SELECT r.id, r.pickup_at, r.return_at, l.quantity,
                  (SELECT COUNT(*) FROM reservation_assets ra WHERE ra.reservation_line_id=l.id AND ra.actual_pickup_at IS NOT NULL) AS collected,
                  CASE WHEN r.borrower_type='PERSON' THEN bu.name ELSE ch.name END AS borrower_name,
                  ch.name AS chapter_name
             FROM reservations r
             JOIN reservation_lines l ON l.reservation_id=r.id
             LEFT JOIN user bu ON bu.id=r.borrower_user_id
             LEFT JOIN chapters ch ON ch.id=r.chapter_id
            WHERE r.status='APPROVED'
              AND r.pickup_at <= ? AND ? < r.return_at
              AND l.equipment_item_id = ?`,
          [timestamp, timestamp, asset.equipment_item_id]
        );

        const needed = eligible.filter((r) => Number(r.collected) < Number(r.quantity));

        if (needed.length === 0) {
          throw new DomainError(
            409,
            "NO_ELIGIBLE_RESERVATION",
            "No approved reservation is currently awaiting this equipment."
          );
        }
        if (needed.length > 1) {
          return {
            code: "RESERVATION_SELECTION_REQUIRED",
            assetName: asset.equipment_name,
            assetCode: asset.asset_code,
            reservations: needed.map((r) => ({
              id: r.id,
              borrowerName: r.borrower_name,
              chapterName: r.chapter_name,
              pickupAt: new Date(Number(r.pickup_at)).toISOString(),
              returnAt: new Date(Number(r.return_at)).toISOString(),
              quantity: Number(r.quantity),
              uncollectedCount: Number(r.quantity) - Number(r.collected),
            })),
          };
        }

        targetReservationId = needed[0].id;
      }

      const collected = await collectMaterial(tx, actor, targetReservationId, asset.id, timestamp);
      const activeAssignment = { ...collected, reservation_id: targetReservationId };
      await notify(
        tx,
        activeAssignment.requested_by_user_id,
        "ASSET_CHECKED_OUT",
        "Equipment checked out",
        `${asset.equipment_name} ${asset.asset_code} was checked out.`,
        activeAssignment.reservation_id
      );
      result = {
        operation: "CHECKED_OUT",
        assetName: asset.equipment_name,
        assetCode: asset.asset_code,
        reservationId: targetReservationId,
        borrowerName: activeAssignment.borrower_name,
        returnAt: new Date(Number(activeAssignment.return_at)).toISOString(),
      };
    }

    await tx.execute({
      sql: "INSERT INTO idempotency_keys(actor_id,operation,key,response,created_at) VALUES(?,'ASSET_SCAN',?,?,?)",
      args: [actor.id, idempotencyKey, JSON.stringify(result), timestamp],
    });
    return result;
  });
}

export function tunisDayRange(timestamp = Date.now()) {
  const localStart = DateTime.fromMillis(timestamp, { zone: DISPLAY_TIME_ZONE }).startOf("day");
  return {
    start: localStart.toUTC().toMillis(),
    end: localStart.plus({ days: 1 }).toUTC().toMillis(),
  };
}

export async function boardDashboard(env: Env) {
  const now = Date.now();
  const { start, end } = tunisDayRange(now);
  const [pickups, returns, borrowed, overdue, nextPickups, nextReturns] = await Promise.all([
    one<{ count: number }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r WHERE r.status='APPROVED' AND r.pickup_at>=? AND r.pickup_at<?",
      [start, end]
    ),
    one<{ count: number }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT COUNT(DISTINCT r.id) AS count FROM reservations r JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE ra.state='BORROWED' AND r.return_at>=? AND r.return_at<?",
      [start, end]
    ),
    one<{ count: number }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT COUNT(*) AS count FROM assets WHERE state='BORROWED' AND active=1"
    ),
    one<{ count: number }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT COUNT(DISTINCT ra.asset_id) AS count FROM reservation_assets ra JOIN reservations r ON r.id=ra.reservation_id WHERE ra.state='BORROWED' AND r.return_at<?",
      [now]
    ),
    rows<{ id: string }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT id FROM reservations WHERE status='APPROVED' AND pickup_at>=? ORDER BY pickup_at LIMIT 5",
      [now]
    ),
    rows<{ id: string }>(
      env.CLIENT as unknown as SqlExecutor,
      "SELECT DISTINCT r.id FROM reservations r JOIN reservation_assets ra ON ra.reservation_id=r.id WHERE ra.state='BORROWED' AND r.return_at>=? ORDER BY r.return_at LIMIT 5",
      [now]
    ),
  ]);
  return {
    pickupsToday: Number(pickups?.count ?? 0),
    returnsToday: Number(returns?.count ?? 0),
    currentlyBorrowed: Number(borrowed?.count ?? 0),
    overdue: Number(overdue?.count ?? 0),
    nextPickups: await Promise.all(
      nextPickups.map(({ id: reservationId }) => getReservation(env, reservationId, true))
    ),
    nextReturns: await Promise.all(
      nextReturns.map(({ id: reservationId }) => getReservation(env, reservationId, true))
    ),
  };
}

export async function calendarEvents(
  env: Env,
  start: number,
  end: number,
  filters: { equipmentItemId?: string; borrower?: string; status?: string } = {}
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    end - start > 93 * 86_400_000
  ) {
    throw new DomainError(400, "INVALID_TIME_RANGE", "Choose a calendar range under 93 days.");
  }
  await reconcileExpiredReservations(env);
  const ids = await rows<{ id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    `SELECT DISTINCT r.id FROM reservations r
       LEFT JOIN reservation_assets ra ON ra.reservation_id=r.id
      WHERE ((r.status IN ('APPROVED', 'COMPLETED') AND r.pickup_at < ? AND ? < r.return_at) OR ra.state='BORROWED')
      ORDER BY r.pickup_at`,
    [end, start]
  );
  const reservations = await Promise.all(
    ids.map(({ id: reservationId }) => getReservation(env, reservationId, true))
  );
  return reservations
    .filter((reservation): reservation is ReservationDTO => Boolean(reservation))
    .flatMap((reservation) =>
      reservation.items
        .filter(
          (item) => !filters.equipmentItemId || item.equipmentItemId === filters.equipmentItemId
        )
        .filter(() => !filters.borrower || reservation.borrower.id === filters.borrower)
        .filter(
          () =>
            !filters.status ||
            reservation.derivedStatus === filters.status ||
            reservation.status === filters.status
        )
        .map((item) => ({
          id: `${reservation.id}:${item.lineId}`,
          reservationId: reservation.id,
          lineId: item.lineId,
          assetId: item.lineId,
          title: `${item.quantity}× ${item.name} · ${reservation.borrower.name}`,
          equipmentName: item.name,
          assetCode: `${item.quantity} units`,
          quantity: item.quantity,
          borrowerName: reservation.borrower.name,
          requesterName: reservation.requestedBy.name,
          start: reservation.pickupAt,
          end: reservation.returnAt,
          status: reservation.derivedStatus,
        }))
    );
}

export async function listBoardAudit(env: Env) {
  return rows<Record<string, unknown>>(
    env.CLIENT as unknown as SqlExecutor,
    `SELECT a.id,a.entity_type AS entityType,a.entity_id AS entityId,a.action,a.created_at AS createdAt,
            a.data,CASE WHEN a.actor_type='SYSTEM' THEN 'System · ' || a.actor_id ELSE u.name END AS actorName
       FROM audit_events a LEFT JOIN user u ON u.id=a.actor_user_id
      ORDER BY a.created_at DESC LIMIT 100`
  );
}

export function createQrToken() {
  return opaqueToken();
}

export function randomId(prefix: string) {
  return id(prefix);
}

export async function deliverNotificationEmails(
  env: Env,
  now = Date.now()
): Promise<{ sent: number; skipped: number; pending: number }> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    return { sent: 0, skipped: 0, pending: 0 };
  }

  const pendingRows = await rows<{
    notification_id: string;
    attempts: number;
    title: string;
    message: string;
    user_email: string | null;
  }>(
    env.CLIENT as unknown as SqlExecutor,
    `SELECT ne.notification_id, ne.attempts, n.title, n.message, u.email AS user_email
     FROM notification_emails ne
     JOIN notifications n ON n.id = ne.notification_id
     LEFT JOIN user u ON u.id = n.user_id
     WHERE ne.status = 'PENDING' AND ne.next_attempt_at <= ?
     ORDER BY ne.next_attempt_at ASC
     LIMIT 25`,
    [now]
  );

  let sent = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (const row of pendingRows) {
    if (Date.now() - startTime > 16_000) break;

    if (!row.user_email) {
      await env.CLIENT.execute({
        sql: "UPDATE notification_emails SET status = 'SKIPPED' WHERE notification_id = ?",
        args: [row.notification_id],
      });
      skipped++;
      continue;
    }

    try {
      await sendEmail(env, row.user_email, row.title, `<p>${escapeHtml(row.message)}</p>`);
      await env.CLIENT.execute({
        sql: "UPDATE notification_emails SET status = 'SENT', attempts = attempts + 1, sent_at = ?, next_attempt_at = 0 WHERE notification_id = ?",
        args: [Date.now(), row.notification_id],
      });
      sent++;
    } catch {
      await env.CLIENT.execute({
        sql: "UPDATE notification_emails SET status = 'PENDING', attempts = attempts + 1, next_attempt_at = ? WHERE notification_id = ?",
        args: [now + 5 * 60_000, row.notification_id],
      });
    }
  }

  return { sent, skipped, pending: pendingRows.length - sent - skipped };
}

export async function runReservationMaintenance(env: Env, now = Date.now()) {
  const expiredReservations = await expireUncollectedReservations(env, now);
  await reconcileExpiredReservations(env, now);
  const reminders = await refreshAllReturnNotifications(env, now);
  const emailResults = await deliverNotificationEmails(env, now);
  return {
    expiredReservations,
    remindersCreated: reminders.notificationsCreated,
    emailsSent: emailResults.sent,
  };
}
