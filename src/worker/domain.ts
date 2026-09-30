import { DateTime } from "luxon";
import type { Client, InArgs, InStatement, ResultSet } from "@libsql/client";
import type { Env, CurrentUser } from "./env";
import { DomainError } from "./security";

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

async function one<T>(executor: SqlExecutor, sql: string, args: SqlArg[] = []) {
  return (await rows<T>(executor, sql, args))[0] ?? null;
}

async function write<T>(env: Env, operation: (transaction: WriteTransaction) => Promise<T>) {
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

function notify(
  tx: SqlExecutor,
  userId: string,
  type: string,
  title: string,
  message: string,
  reservationId: string | null = null
) {
  return tx.execute({
    sql: "INSERT INTO notifications(id,user_id,type,title,message,reservation_id,created_at) VALUES(?,?,?,?,?,?,?)",
    args: [id("notification"), userId, type, title, message, reservationId, Date.now()],
  });
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
       INNER JOIN equipment_items e ON e.id=a.equipment_item_id
      WHERE a.equipment_item_id=? AND e.active=1 AND a.active=1
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

export interface CatalogueItem {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl: string | null;
  availableQuantity: number;
}

export async function listCatalogue(env: Env, pickupAt: number, returnAt: number) {
  const items = await rows<Omit<CatalogueItem, "availableQuantity">>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT id,name,description,category,image_url AS imageUrl FROM equipment_items WHERE active=1 ORDER BY category,name"
  );
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      availableQuantity: (
        await findAvailableAssets(env.CLIENT as unknown as SqlExecutor, item.id, pickupAt, returnAt)
      ).length,
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
  if (borrowedCount > 0 && now > Number(reservation.return_at)) derivedStatus = "OVERDUE";
  else if (borrowedCount > 0 && returnedCount > 0) derivedStatus = "PARTIALLY_RETURNED";
  else if (borrowedCount > 0) derivedStatus = "BORROWED";
  else if (reservation.status === "COMPLETED") derivedStatus = "RETURNED";

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
  const ids = await rows<{ id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT id FROM reservations WHERE requested_by_user_id=? ORDER BY pickup_at DESC LIMIT 200",
    [ownerId]
  );
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId)));
}

export async function listBoardReservations(env: Env) {
  const ids = await rows<{ id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    "SELECT id FROM reservations ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,pickup_at ASC LIMIT 500"
  );
  return Promise.all(ids.map(({ id: reservationId }) => getReservation(env, reservationId, true)));
}

export interface CreateReservationInput {
  borrowerType: "PERSON" | "CHAPTER";
  chapterId?: string;
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
  if (input.borrowerType === "CHAPTER" && !input.chapterId) {
    throw new DomainError(400, "VALIDATION", "Choose a chapter to borrow this equipment.");
  }
  if (input.borrowerType === "PERSON" && input.chapterId) {
    throw new DomainError(400, "VALIDATION", "A personal reservation cannot name a chapter.");
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
    if (input.borrowerType === "CHAPTER") {
      const chapter = await one<{ id: string }>(
        tx,
        "SELECT id FROM chapters WHERE id=? AND active=1",
        [input.chapterId!]
      );
      if (!chapter)
        throw new DomainError(
          400,
          "VALIDATION",
          "That chapter is unavailable for new reservations."
        );
    }
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
      const candidates = await findAvailableAssets(
        tx,
        line.equipmentItemId,
        input.pickupAt,
        input.returnAt
      );
      if (candidates.length < line.quantity) {
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
        input.borrowerType,
        input.borrowerType === "PERSON" ? actor.id : null,
        input.borrowerType === "CHAPTER" ? input.chapterId! : null,
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

export async function approveReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string,
  assignments?: Record<string, string[]>
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
    const lines = await rows<{ id: string; equipment_item_id: string; quantity: number }>(
      tx,
      "SELECT id,equipment_item_id,quantity FROM reservation_lines WHERE reservation_id=? ORDER BY equipment_item_id",
      [reservationId]
    );
    const selections: Array<{ lineId: string; asset: AvailableAsset }> = [];
    for (const line of lines) {
      const available = await findAvailableAssets(
        tx,
        line.equipment_item_id,
        Number(reservation.pickup_at),
        Number(reservation.return_at)
      );
      const requestedIds = assignments?.[line.id];
      const chosen = requestedIds
        ? requestedIds
            .map((assetId) => available.find((candidate) => candidate.id === assetId))
            .filter((asset): asset is AvailableAsset => Boolean(asset))
        : available.slice(0, Number(line.quantity));
      if (
        requestedIds &&
        (requestedIds.length !== Number(line.quantity) ||
          chosen.length !== requestedIds.length ||
          new Set(requestedIds).size !== requestedIds.length)
      ) {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "The selected assets are no longer available for this reservation."
        );
      }
      if (chosen.length !== Number(line.quantity)) {
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "Approval failed — equipment is no longer available."
        );
      }
      selections.push(...chosen.map((asset) => ({ lineId: line.id, asset })));
    }

    const timestamp = Date.now();
    for (const selection of selections) {
      const restored = await tx.execute({
        sql: "UPDATE reservation_assets SET reservation_line_id=?,state='RESERVED',actual_pickup_at=NULL,checked_out_by_user_id=NULL,actual_return_at=NULL,checked_in_by_user_id=NULL,updated_at=? WHERE reservation_id=? AND asset_id=? AND state='RELEASED'",
        args: [selection.lineId, timestamp, reservationId, selection.asset.id],
      });
      if (Number(restored.rowsAffected) === 0) {
        await tx.execute({
          sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,created_at,updated_at) VALUES(?,?,?,?, 'RESERVED',?,?)",
          args: [
            id("reservation_asset"),
            reservationId,
            selection.lineId,
            selection.asset.id,
            timestamp,
            timestamp,
          ],
        });
      }
      const assetUpdate = await tx.execute({
        sql: "UPDATE assets SET state='RESERVED',updated_at=? WHERE id=? AND state IN ('AVAILABLE','RESERVED') AND active=1",
        args: [timestamp, selection.asset.id],
      });
      if (Number(assetUpdate.rowsAffected) !== 1)
        throw new DomainError(
          409,
          "RESERVATION_CONFLICT",
          "An asset changed while this reservation was being approved."
        );
    }
    await tx.execute({
      sql: "UPDATE reservations SET status='APPROVED',approved_by_user_id=?,updated_at=? WHERE id=? AND status='PENDING'",
      args: [actor.id, timestamp, reservationId],
    });
    await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_APPROVED", {
      assignedAssetIds: selections.map(({ asset }) => asset.id),
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
        "Your equipment reservation has been approved.",
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

export async function forceDeleteReservation(
  env: Env,
  actor: CurrentUser,
  reservationId: string
) {
  return await write(env, async (tx) => {
    const reservation = await one<{
      id: string;
      status: string;
      requested_by_user_id: string;
    }>(tx, "SELECT id,status,requested_by_user_id FROM reservations WHERE id=?", [
      reservationId,
    ]);
    if (!reservation) throw new DomainError(404, "NOT_FOUND", "Reservation not found.");

    // Release any physical assets currently in RESERVED or BORROWED state
    await tx.execute({
      sql: `UPDATE assets SET state='AVAILABLE', updated_at=?
            WHERE id IN (
              SELECT asset_id FROM reservation_assets
              WHERE reservation_id=? AND state IN ('RESERVED', 'BORROWED')
            ) AND state IN ('RESERVED', 'BORROWED')`,
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
  assignments?: Record<string, string[]>
) {
  const lines = await rows<{ id: string; equipment_item_id: string; quantity: number }>(
    tx,
    "SELECT id,equipment_item_id,quantity FROM reservation_lines WHERE reservation_id=? ORDER BY equipment_item_id",
    [reservationId]
  );
  const selections: Array<{ lineId: string; asset: AvailableAsset }> = [];
  for (const line of lines) {
    const available = await findAvailableAssets(tx, line.equipment_item_id, pickupAt, returnAt);
    const requestedIds = assignments?.[line.id];
    const chosen = requestedIds
      ? requestedIds
          .map((assetId) => available.find((candidate) => candidate.id === assetId))
          .filter((asset): asset is AvailableAsset => Boolean(asset))
      : available.slice(0, Number(line.quantity));
    if (
      requestedIds &&
      (requestedIds.length !== Number(line.quantity) ||
        chosen.length !== requestedIds.length ||
        new Set(requestedIds).size !== requestedIds.length)
    ) {
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "The selected assets are no longer available for this reservation."
      );
    }
    if (chosen.length !== Number(line.quantity))
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "Approval failed — equipment is no longer available."
      );
    selections.push(...chosen.map((asset) => ({ lineId: line.id, asset })));
  }
  const timestamp = Date.now();
  for (const selection of selections) {
    const restored = await tx.execute({
      sql: "UPDATE reservation_assets SET reservation_line_id=?,state='RESERVED',actual_pickup_at=NULL,checked_out_by_user_id=NULL,actual_return_at=NULL,checked_in_by_user_id=NULL,updated_at=? WHERE reservation_id=? AND asset_id=? AND state='RELEASED'",
      args: [selection.lineId, timestamp, reservationId, selection.asset.id],
    });
    if (Number(restored.rowsAffected) === 0) {
      await tx.execute({
        sql: "INSERT INTO reservation_assets(id,reservation_id,reservation_line_id,asset_id,state,created_at,updated_at) VALUES(?,?,?,?, 'RESERVED',?,?)",
        args: [
          id("reservation_asset"),
          reservationId,
          selection.lineId,
          selection.asset.id,
          timestamp,
          timestamp,
        ],
      });
    }
    const assetUpdate = await tx.execute({
      sql: "UPDATE assets SET state='RESERVED',updated_at=? WHERE id=? AND state IN ('AVAILABLE','RESERVED') AND active=1",
      args: [timestamp, selection.asset.id],
    });
    if (Number(assetUpdate.rowsAffected) !== 1)
      throw new DomainError(
        409,
        "RESERVATION_CONFLICT",
        "An asset changed while this reservation was being rescheduled."
      );
  }
  await audit(tx, actor.id, "RESERVATION", reservationId, "RESERVATION_RESCHEDULED", {
    pickupAt,
    returnAt,
    assetIds: selections.map(({ asset }) => asset.id),
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

export interface ScanResult {
  operation: "CHECKED_OUT" | "RETURNED";
  assetName: string;
  assetCode: string;
  borrowerName?: string;
  returnAt?: string;
}

export async function scanAsset(
  env: Env,
  actor: CurrentUser,
  qrToken: string,
  idempotencyKey: string
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
    }>(
      tx,
      "SELECT a.id,a.asset_code,a.state,a.active,a.last_scan_at,e.name AS equipment_name FROM assets a INNER JOIN equipment_items e ON e.id=a.equipment_item_id WHERE a.qr_token=?",
      [qrToken]
    );
    if (!asset) throw new DomainError(404, "INVALID_ASSET", "No equipment matches this QR code.");
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
      const nextReservation = await one<{ id: string }>(
        tx,
        `SELECT r.id FROM reservation_assets ra INNER JOIN reservations r ON r.id=ra.reservation_id
          WHERE ra.asset_id=? AND ra.state='RESERVED' AND r.status='APPROVED' AND r.pickup_at<=? AND ?<r.return_at LIMIT 1`,
        [asset.id, timestamp, timestamp]
      );
      await tx.execute({
        sql: "UPDATE assets SET state=?,last_scan_at=?,updated_at=? WHERE id=?",
        args: [nextReservation ? "RESERVED" : "AVAILABLE", timestamp, timestamp, asset.id],
      });
      const unfinished = await one<{ count: number }>(
        tx,
        "SELECT COUNT(*) AS count FROM reservation_assets WHERE reservation_id=? AND state IN ('RESERVED','BORROWED')",
        [assignment.reservation_id]
      );
      if (Number(unfinished?.count ?? 0) === 0) {
        await tx.execute({
          sql: "UPDATE reservations SET status='COMPLETED',updated_at=? WHERE id=? AND status IN ('APPROVED','CANCELLED')",
          args: [timestamp, assignment.reservation_id],
        });
      }
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
      };
    } else {
      const activeAssignment = await one<{
        id: string;
        reservation_id: string;
        pickup_at: number;
        return_at: number;
        borrower_name: string;
        requested_by_user_id: string;
      }>(
        tx,
        `SELECT ra.id,ra.reservation_id,r.pickup_at,r.return_at,r.requested_by_user_id,
                CASE WHEN r.borrower_type='PERSON' THEN bu.name ELSE ch.name END AS borrower_name
           FROM reservation_assets ra
           INNER JOIN reservations r ON r.id=ra.reservation_id
           LEFT JOIN user bu ON bu.id=r.borrower_user_id
           LEFT JOIN chapters ch ON ch.id=r.chapter_id
          WHERE ra.asset_id=? AND ra.state='RESERVED' AND r.status='APPROVED'
          ORDER BY r.pickup_at ASC LIMIT 1`,
        [asset.id]
      );
      if (!activeAssignment)
        throw new DomainError(409, "NOT_FOUND", "No approved reservation found for this asset.");
      if (timestamp < Number(activeAssignment.pickup_at)) {
        throw new DomainError(
          409,
          "TOO_EARLY",
          `Reservation starts at ${formatTunis(Number(activeAssignment.pickup_at))}. Checkout is not active yet.`
        );
      }
      if (timestamp >= Number(activeAssignment.return_at)) {
        throw new DomainError(
          409,
          "RESERVATION_EXPIRED",
          "Reservation window has expired. Update or recreate the reservation."
        );
      }
      await tx.execute({
        sql: "UPDATE reservation_assets SET state='BORROWED',actual_pickup_at=?,checked_out_by_user_id=?,updated_at=? WHERE id=? AND state='RESERVED'",
        args: [timestamp, actor.id, timestamp, activeAssignment.id],
      });
      await tx.execute({
        sql: "UPDATE assets SET state='BORROWED',last_scan_at=?,updated_at=? WHERE id=?",
        args: [timestamp, timestamp, asset.id],
      });
      await audit(tx, actor.id, "ASSET", asset.id, "ASSET_CHECKED_OUT", {
        reservationId: activeAssignment.reservation_id,
      });
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

function formatTunis(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
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
  const ids = await rows<{ id: string }>(
    env.CLIENT as unknown as SqlExecutor,
    `SELECT DISTINCT r.id FROM reservations r
       INNER JOIN reservation_assets ra ON ra.reservation_id=r.id
      WHERE ((r.status='APPROVED' AND r.pickup_at < ? AND ? < r.return_at) OR ra.state='BORROWED')
      ORDER BY r.pickup_at`,
    [end, start]
  );
  const reservations = await Promise.all(
    ids.map(({ id: reservationId }) => getReservation(env, reservationId, true))
  );
  return reservations
    .filter((reservation): reservation is ReservationDTO => Boolean(reservation))
    .flatMap((reservation) =>
      reservation.items.flatMap((item) =>
        (item.assignedAssets ?? [])
          .filter((asset) => asset.state === "RESERVED" || asset.state === "BORROWED")
          .filter(
            () => !filters.equipmentItemId || item.equipmentItemId === filters.equipmentItemId
          )
          .filter(() => !filters.borrower || reservation.borrower.id === filters.borrower)
          .filter(
            () =>
              !filters.status ||
              reservation.derivedStatus === filters.status ||
              reservation.status === filters.status
          )
          .map((asset) => ({
            id: `${reservation.id}:${asset.id}`,
            reservationId: reservation.id,
            assetId: asset.id,
            title: `${item.name} ${asset.assetCode} · ${reservation.borrower.name}`,
            equipmentName: item.name,
            assetCode: asset.assetCode,
            borrowerName: reservation.borrower.name,
            requesterName: reservation.requestedBy.name,
            start: reservation.pickupAt,
            end: reservation.returnAt,
            status: reservation.derivedStatus,
          }))
      )
    );
}

export async function listBoardAudit(env: Env) {
  return rows<Record<string, unknown>>(
    env.CLIENT as unknown as SqlExecutor,
    `SELECT a.id,a.entity_type AS entityType,a.entity_id AS entityId,a.action,a.created_at AS createdAt,
            a.data,u.name AS actorName
       FROM audit_events a INNER JOIN user u ON u.id=a.actor_user_id
      ORDER BY a.created_at DESC LIMIT 100`
  );
}

export function createQrToken() {
  return opaqueToken();
}

export function randomId(prefix: string) {
  return id(prefix);
}
