import {
  IBoardUserService,
  ProcessUserPayload,
  UpdateUserClearancePayload,
  UpdateUserRolePayload,
  UpdateUserStatusPayload,
} from "@/services/contracts/board/users";
import { UserProfile, ClearanceLevel, Affiliation, Role, UserStatus } from "@/types";
import { mockDb } from "@/mocks/db";
import { mockBoardAuditLogService } from "./audit-log";
import {
  canonicalClearance,
  memberClearance,
  requireOperator,
  requireSuperadmin,
  refreshStrikeDerivedProfile,
  requireOperatorInDraft,
  requireSuperadminInDraft,
} from "../authorization";

class MockBoardUserService implements IBoardUserService {
  private async simulateLatency(): Promise<void> {
    await new Promise((res) => setTimeout(res, 50));
  }

  async getUsers(filters?: {
    search?: string;
    role?: Role | "ALL";
    clearance?: ClearanceLevel | "ALL";
    affiliation?: Affiliation | "ALL";
    unprocessedOnly?: boolean;
    status?: UserStatus | "ALL";
  }): Promise<UserProfile[]> {
    await this.simulateLatency();
    const snapshot = mockDb.getSnapshot();
    let users = Object.values(snapshot.userProfiles).map((user) =>
      refreshStrikeDerivedProfile(snapshot, user.id)
    );

    if (filters?.role && filters.role !== "ALL") {
      users = users.filter((u) => u.role === filters.role);
    }
    if (filters?.clearance && filters.clearance !== "ALL") {
      users = users.filter((u) => u.clearance === filters.clearance);
    }
    if (filters?.affiliation && filters.affiliation !== "ALL") {
      users = users.filter((u) => u.affiliation === filters.affiliation);
    }
    if (filters?.unprocessedOnly) {
      users = users.filter((u) => !u.isProcessed);
    }
    if (filters?.status && filters.status !== "ALL") {
      users = users.filter((u) => u.status === filters.status);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      users = users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.studentId && u.studentId.toLowerCase().includes(q)) ||
          (u.phone && u.phone.toLowerCase().includes(q))
      );
    }

    return users.sort((a, b) => (a.isProcessed === b.isProcessed ? 0 : a.isProcessed ? 1 : -1));
  }

  async getUserById(userId: string): Promise<UserProfile | null> {
    await this.simulateLatency();
    const snapshot = mockDb.getSnapshot();
    const user = snapshot.userProfiles[userId];
    if (user) refreshStrikeDerivedProfile(snapshot, userId);
    return user ? { ...user } : null;
  }

  async processUser(
    payload: ProcessUserPayload,
    actorUserId: string,
    _actorRole: string
  ): Promise<UserProfile> {
    await this.simulateLatency();
    const actor = requireOperator(actorUserId);
    let updatedUser: UserProfile | null = null;

    mockDb.mutate((draft) => {
      const draftActor = requireOperatorInDraft(draft, actorUserId);
      const privilegedAffiliation = ["EUROBOT", "RAS_BOARD"].includes(payload.verifiedAffiliation);
      if (privilegedAffiliation && draft.userProfiles[payload.userId]?.role === "MEMBER")
        requireSuperadminInDraft(draft, actorUserId);
      const user = draft.userProfiles[payload.userId];
      if (!user) throw new Error("User not found");

      user.isProcessed = true;
      user.verifiedAffiliation = payload.verifiedAffiliation;
      user.affiliation = payload.verifiedAffiliation;
      if (privilegedAffiliation && user.role === "MEMBER") user.role = "OPERATOR";
      if (user.role === "MEMBER" && user.clearanceSource !== "MANUAL_LEVEL_IV") {
        user.clearanceSource = "AFFILIATION";
      }
      if (user.role === "OPERATOR") user.clearanceSource = "OPERATOR_ROLE";
      user.clearance = canonicalClearance(user);
      user.verifiedBy = draftActor.name;
      user.verifiedAt = new Date().toISOString();
      if (payload.notes) user.notes = payload.notes;

      updatedUser = { ...user };
    });

    if (updatedUser) {
      await mockBoardAuditLogService.logEvent({
        actorUserId,
        actorName: "Board Custodian",
        actorRole: actor.role,
        action: "USER_PROCESSED",
        entityType: "USER",
        entityId: payload.userId,
        after: updatedUser,
        reason: payload.notes || `Verified affiliation as ${payload.verifiedAffiliation}`,
      });

      return updatedUser;
    }
    throw new Error("Failed to process user");
  }

  async updateClearance(
    payload: UpdateUserClearancePayload,
    actorUserId: string,
    _actorRole: string,
    _actorClearance: string
  ): Promise<UserProfile> {
    await this.simulateLatency();
    const actor = requireOperator(actorUserId);
    let updatedUser: UserProfile | null = null;

    mockDb.mutate((draft) => {
      requireOperatorInDraft(draft, actorUserId);
      const user = draft.userProfiles[payload.userId];
      if (!user) throw new Error("User not found");

      if (user.role !== "MEMBER") throw new Error("Operator clearance is role-derived");
      if (payload.newClearance === "IV" || user.clearance === "IV")
        requireSuperadminInDraft(draft, actorUserId);
      if (
        payload.newClearance !== "IV" &&
        payload.newClearance !== memberClearance(user.affiliation)
      ) {
        throw new Error("Member clearance must match verified affiliation");
      }
      user.clearance = payload.newClearance;
      user.clearanceSource = payload.newClearance === "IV" ? "MANUAL_LEVEL_IV" : "AFFILIATION";

      updatedUser = { ...user };
    });

    if (updatedUser) {
      await mockBoardAuditLogService.logEvent({
        actorUserId,
        actorName: "Board Custodian",
        actorRole: actor.role,
        action: "CLEARANCE_CHANGED",
        entityType: "USER",
        entityId: payload.userId,
        after: { clearance: payload.newClearance, source: payload.source },
        reason: payload.reason,
      });

      return updatedUser;
    }
    throw new Error("Failed to update clearance");
  }

  async updateRole(
    payload: UpdateUserRolePayload,
    actorUserId: string,
    _actorRole: string
  ): Promise<UserProfile> {
    await this.simulateLatency();
    const actor = requireSuperadmin(actorUserId);
    let updatedUser: UserProfile | null = null;

    mockDb.mutate((draft) => {
      requireSuperadminInDraft(draft, actorUserId);
      const user = draft.userProfiles[payload.userId];
      if (!user) throw new Error("User not found");

      if (
        payload.newRole === "OPERATOR" &&
        user.affiliation !== "EUROBOT" &&
        user.affiliation !== "RAS_BOARD"
      )
        throw new Error("Operator role requires verified Eurobot or RAS Board affiliation");
      if (
        payload.newRole === "MEMBER" &&
        (user.affiliation === "EUROBOT" || user.affiliation === "RAS_BOARD")
      )
        throw new Error("Verify a member affiliation before demotion");

      user.role = payload.newRole;
      user.clearanceSource =
        payload.newRole === "SUPERADMIN"
          ? "SUPERADMIN_ROLE"
          : payload.newRole === "OPERATOR"
            ? "OPERATOR_ROLE"
            : "AFFILIATION";
      user.clearance = canonicalClearance(user);

      updatedUser = { ...user };
    });

    if (updatedUser) {
      await mockBoardAuditLogService.logEvent({
        actorUserId,
        actorName: actor.name,
        actorRole: actor.role,
        action: "ROLE_CHANGED",
        entityType: "USER",
        entityId: payload.userId,
        after: { role: payload.newRole, clearance: (updatedUser as UserProfile).clearance },
        reason: payload.reason,
      });

      return updatedUser;
    }
    throw new Error("Failed to update role");
  }

  async updateStatus(
    payload: UpdateUserStatusPayload,
    actorUserId: string,
    _actorRole: string
  ): Promise<UserProfile> {
    await this.simulateLatency();
    const actor = requireOperator(actorUserId);
    let updatedUser: UserProfile | null = null;

    mockDb.mutate((draft) => {
      const actualActor = requireOperatorInDraft(draft, actorUserId);
      const user = draft.userProfiles[payload.userId];
      if (!user) throw new Error("User not found");

      if (payload.status === "BLACKLISTED" || user.status === "BLACKLISTED") {
        requireSuperadminInDraft(draft, actorUserId);
      }

      if (payload.status === "BLACKLISTED") user.manualBlacklisted = true;
      else if (user.manualBlacklisted) {
        requireSuperadminInDraft(draft, actorUserId);
        user.manualBlacklisted = false;
      }
      user.status = payload.status;
      user.isBanned = payload.status === "BLACKLISTED" || payload.status === "BANNED";
      void actualActor;
      updatedUser = { ...user };
    });

    if (updatedUser) {
      await mockBoardAuditLogService.logEvent({
        actorUserId,
        actorName: "Board Custodian",
        actorRole: actor.role,
        action: "STATUS_CHANGED",
        entityType: "USER",
        entityId: payload.userId,
        after: { status: payload.status },
        reason: payload.reason,
      });

      return updatedUser;
    }
    throw new Error("Failed to update status");
  }

  async createUser(
    payload: import("@/services/contracts/board/users").CreateUserPayload,
    actorUserId: string,
    _actorRole: string
  ): Promise<UserProfile> {
    await this.simulateLatency();
    const actor = requireOperator(actorUserId);
    const newId = `user-${Date.now()}`;
    const affiliation = payload.affiliation || (payload.role === "MEMBER" ? "IEEE" : "RAS_BOARD");
    const clearance =
      payload.clearance ||
      (payload.role === "SUPERADMIN"
        ? "VI"
        : payload.role === "OPERATOR"
          ? "V"
          : affiliation === "IEEE"
            ? "III"
            : affiliation === "AEROBOTIX"
              ? "II"
              : "I");

    const newUser: UserProfile = {
      id: newId,
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone?.trim() || "",
      role: payload.role,
      clearance,
      clearanceSource:
        payload.role === "SUPERADMIN"
          ? "SUPERADMIN_ROLE"
          : payload.role === "OPERATOR"
            ? "OPERATOR_ROLE"
            : "AFFILIATION",
      affiliation,
      claimedAffiliation: affiliation,
      verifiedAffiliation: affiliation,
      isProcessed: true,
      status: "ACTIVE",
      joinedDate: new Date().toISOString(),
      strikesCount: 0,
      strikes: [],
      activeLoansCount: 0,
      totalRequestsCount: 0,
    };

    mockDb.mutate((draft) => {
      draft.userProfiles[newId] = newUser;
    });

    await mockBoardAuditLogService.logEvent({
      actorUserId,
      actorName: "Board Custodian",
      actorRole: actor.role,
      action: "USER_CREATED",
      entityType: "USER",
      entityId: newId,
      after: { email: newUser.email, role: newUser.role },
      reason: "User created via Board People portal",
    });

    return newUser;
  }

  async removeUser(
    userId: string,
    actorUserId: string,
    _actorRole: string
  ): Promise<{ success: boolean }> {
    await this.simulateLatency();
    const actor = requireOperator(actorUserId);
    if (userId === actorUserId) {
      throw new Error("You cannot remove your own account");
    }

    mockDb.mutate((draft) => {
      delete draft.userProfiles[userId];
    });

    await mockBoardAuditLogService.logEvent({
      actorUserId,
      actorName: "Board Custodian",
      actorRole: actor.role,
      action: "USER_REMOVED",
      entityType: "USER",
      entityId: userId,
      reason: "User removed via Board People portal",
    });

    return { success: true };
  }
}

export const mockBoardUserService = new MockBoardUserService();
