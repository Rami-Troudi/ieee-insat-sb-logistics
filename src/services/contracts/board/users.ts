import {
  UserProfile,
  Affiliation,
  ClearanceLevel,
  Role,
  UserStatus,
  ClearanceSource,
} from "@/types";

export interface ProcessUserPayload {
  userId: string;
  verifiedAffiliation: Affiliation;
  notes?: string;
}

export interface UpdateUserClearancePayload {
  userId: string;
  newClearance: ClearanceLevel;
  source: ClearanceSource;
  reason: string;
}

export interface UpdateUserRolePayload {
  userId: string;
  newRole: Role;
  reason: string;
}

export interface UpdateUserStatusPayload {
  userId: string;
  status: UserStatus;
  reason: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  phone?: string;
  role: Role;
  clearance?: ClearanceLevel;
  affiliation?: Affiliation;
}

export interface IBoardUserService {
  getUsers(filters?: {
    search?: string;
    role?: Role | "ALL";
    clearance?: ClearanceLevel | "ALL";
    affiliation?: Affiliation | "ALL";
    unprocessedOnly?: boolean;
    status?: UserStatus | "ALL";
  }): Promise<UserProfile[]>;
  getUserById(userId: string): Promise<UserProfile | null>;
  createUser(
    payload: CreateUserPayload,
    actorUserId: string,
    actorRole: string
  ): Promise<UserProfile>;
  removeUser(
    userId: string,
    actorUserId: string,
    actorRole: string
  ): Promise<{ success: boolean }>;
  processUser(
    payload: ProcessUserPayload,
    actorUserId: string,
    actorRole: string
  ): Promise<UserProfile>;
  updateClearance(
    payload: UpdateUserClearancePayload,
    actorUserId: string,
    actorRole: string
  ): Promise<UserProfile>;
  updateRole(
    payload: UpdateUserRolePayload,
    actorUserId: string,
    actorRole: string
  ): Promise<UserProfile>;
  updateStatus(
    payload: UpdateUserStatusPayload,
    actorUserId: string,
    actorRole: string
  ): Promise<UserProfile>;
}
