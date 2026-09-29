import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/app/query-client";
import { boardUserService } from "@/services";
import {
  ProcessUserPayload,
  UpdateUserClearancePayload,
  UpdateUserRolePayload,
  UpdateUserStatusPayload,
  CreateUserPayload,
} from "@/services/contracts/board/users";
import { Role, ClearanceLevel, Affiliation, UserStatus } from "@/types";

export interface BoardUserFilterParams {
  search?: string;
  role?: Role | "ALL";
  clearance?: ClearanceLevel | "ALL";
  affiliation?: Affiliation | "ALL";
  unprocessedOnly?: boolean;
  status?: UserStatus | "ALL";
}

export interface ProcessUserParams {
  payload: ProcessUserPayload;
  actorUserId: string;
  actorRole: string;
}

export interface UpdateClearanceParams {
  payload: UpdateUserClearancePayload;
  actorUserId: string;
  actorRole: string;
}

export interface UpdateRoleParams {
  payload: UpdateUserRolePayload;
  actorUserId: string;
  actorRole: string;
}

export interface UpdateStatusParams {
  payload: UpdateUserStatusPayload;
  actorUserId: string;
  actorRole: string;
}

export interface CreateUserParams {
  payload: CreateUserPayload;
  actorUserId: string;
  actorRole: string;
}

export interface RemoveUserParams {
  userId: string;
  actorUserId: string;
  actorRole: string;
}

export function useBoardUsers(filters?: BoardUserFilterParams) {
  return useQuery({
    queryKey: QUERY_KEYS.boardUsers.list(filters),
    queryFn: () => boardUserService.getUsers(filters),
  });
}

export function useBoardUserDetail(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.boardUsers.detail(id),
    queryFn: () => boardUserService.getUserById(id),
    enabled: Boolean(id),
  });
}

export function useProcessUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, actorUserId, actorRole }: ProcessUserParams) =>
      boardUserService.processUser(payload, actorUserId, actorRole),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.boardUsers.detail(variables.payload.userId),
      });
    },
  });
}

export function useUpdateUserClearance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, actorUserId, actorRole }: UpdateClearanceParams) =>
      boardUserService.updateClearance(payload, actorUserId, actorRole),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.boardUsers.detail(variables.payload.userId),
      });
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, actorUserId, actorRole }: UpdateRoleParams) =>
      boardUserService.updateRole(payload, actorUserId, actorRole),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.boardUsers.detail(variables.payload.userId),
      });
    },
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, actorUserId, actorRole }: UpdateStatusParams) =>
      boardUserService.updateStatus(payload, actorUserId, actorRole),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.boardUsers.detail(variables.payload.userId),
      });
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, actorUserId, actorRole }: CreateUserParams) =>
      boardUserService.createUser(payload, actorUserId, actorRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
    },
  });
}

export function useRemoveUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, actorUserId, actorRole }: RemoveUserParams) =>
      boardUserService.removeUser(userId, actorUserId, actorRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.boardUsers.all });
    },
  });
}

