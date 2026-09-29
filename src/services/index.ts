import { IInventoryService } from "./contracts/inventory";
import { IRequestService } from "./contracts/requests";
import { ILoanService } from "./contracts/loans";
import { INotificationService } from "./contracts/notifications";
import { IProfileService, IProjectService } from "./contracts/profile";
import { IAuthService } from "./contracts/auth";

// Board services
import { IBoardAllocationService } from "./contracts/board/allocations";
import { IBoardRequestService } from "./contracts/board/requests";
import { IBoardLoanService } from "./contracts/board/loans";
import { IBoardInventoryService } from "./contracts/board/inventory";
import { IBoardUserService } from "./contracts/board/users";
import { IBoardProjectService } from "./contracts/board/projects";
import { IBoardAuditService } from "./contracts/board/audits";
import { IBoardDisciplineService } from "./contracts/board/discipline";
import { IBoardInsightsService } from "./contracts/board/insights";
import { IBoardExportService } from "./contracts/board/exports";
import { IBoardAuditLogService } from "./contracts/board/audit-log";

import {
  remoteInventoryService,
  remoteRequestService,
  remoteLoanService,
  remoteNotificationService,
  remoteProfileService,
  remoteProjectService,
  remoteAuthService,
  remoteBoardAllocationService,
  remoteBoardRequestService,
  remoteBoardLoanService,
  remoteBoardInventoryService,
  remoteBoardUserService,
  remoteBoardProjectService,
  remoteBoardAuditService,
  remoteBoardDisciplineService,
  remoteBoardInsightsService,
  remoteBoardExportService,
  remoteBoardAuditLogService,
} from "./remote";

// Member Public Services
export const inventoryService: IInventoryService = remoteInventoryService as IInventoryService;
export const requestService: IRequestService = remoteRequestService as IRequestService;
export const loanService: ILoanService = remoteLoanService as ILoanService;
export const notificationService: INotificationService =
  remoteNotificationService as INotificationService;
export const profileService: IProfileService = remoteProfileService as IProfileService;
export const projectService: IProjectService = remoteProjectService as IProjectService;
export const authService: IAuthService = remoteAuthService as IAuthService;

// Board Public Services
export const boardAllocationService: IBoardAllocationService =
  remoteBoardAllocationService as IBoardAllocationService;
export const boardRequestService: IBoardRequestService =
  remoteBoardRequestService as IBoardRequestService;
export const boardLoanService: IBoardLoanService = remoteBoardLoanService as IBoardLoanService;
export const boardInventoryService: IBoardInventoryService =
  remoteBoardInventoryService as IBoardInventoryService;
export const boardUserService: IBoardUserService = remoteBoardUserService as IBoardUserService;
export const boardProjectService: IBoardProjectService =
  remoteBoardProjectService as IBoardProjectService;
export const boardAuditService: IBoardAuditService = remoteBoardAuditService as IBoardAuditService;
export const boardDisciplineService: IBoardDisciplineService =
  remoteBoardDisciplineService as IBoardDisciplineService;
export const boardInsightsService: IBoardInsightsService =
  remoteBoardInsightsService as IBoardInsightsService;
export const boardExportService: IBoardExportService =
  remoteBoardExportService as IBoardExportService;
export const boardAuditLogService: IBoardAuditLogService =
  remoteBoardAuditLogService as IBoardAuditLogService;

// Re-exports
export * from "./contracts/inventory";
export * from "./contracts/requests";
export * from "./contracts/loans";
export * from "./contracts/notifications";
export * from "./contracts/profile";
export * from "./contracts/auth";

export * from "./contracts/board/allocations";
export * from "./contracts/board/requests";
export * from "./contracts/board/loans";
export * from "./contracts/board/inventory";
export * from "./contracts/board/users";
export * from "./contracts/board/projects";
export * from "./contracts/board/audits";
export * from "./contracts/board/discipline";
export * from "./contracts/board/insights";
export * from "./contracts/board/exports";
export * from "./contracts/board/audit-log";
