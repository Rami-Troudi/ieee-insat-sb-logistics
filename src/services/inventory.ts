import type { IInventoryService } from "./contracts/inventory";
import { remoteInventoryService } from "./remote";

export const inventoryService: IInventoryService = remoteInventoryService as IInventoryService;
