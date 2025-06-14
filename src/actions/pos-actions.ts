/**
 * @fileOverview Generic POS server actions that work with any POS system.
 * These actions use the PosService to abstract away specific implementations.
 */

"use server";

import { posService } from "@/services/pos-integration/pos-service";
import type {
  PosConnectionConfig,
  Product,
  Supplier,
  PosDocument,
  SyncResult,
  OperationResult,
} from "@/services/pos-integration/pos-adapter.interface";

// --- Connection Actions ---

/**
 * Test connection to a POS system
 */
export async function testPosConnectionAction(
  config: PosConnectionConfig
): Promise<{ success: boolean; message: string }> {
  try {
    return await posService.testConnection(config);
  } catch (error: any) {
    console.error("[testPosConnectionAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to test connection",
    };
  }
}

/**
 * Validate POS configuration
 */
export async function validatePosConfigAction(
  config: PosConnectionConfig
): Promise<{ valid: boolean; errors?: { field: string; message: string }[] }> {
  try {
    return await posService.validateConfig(config);
  } catch (error: any) {
    console.error("[validatePosConfigAction] Error:", error);
    return {
      valid: false,
      errors: [{ field: "general", message: error.message || "Validation failed" }],
    };
  }
}

// --- Product Actions ---

/**
 * Create or update a product in the POS system
 */
export async function createOrUpdatePosProductAction(
  config: PosConnectionConfig,
  product: Product
): Promise<OperationResult<{ externalId: string }>> {
  try {
    return await posService.createOrUpdateProduct(config, product);
  } catch (error: any) {
    console.error("[createOrUpdatePosProductAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to create/update product",
      errors: [error],
    };
  }
}

/**
 * Update an existing product in the POS system
 */
export async function updatePosProductAction(
  config: PosConnectionConfig,
  product: Product
): Promise<OperationResult> {
  try {
    return await posService.updateProduct(config, product);
  } catch (error: any) {
    console.error("[updatePosProductAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to update product",
      errors: [error],
    };
  }
}

/**
 * Deactivate a product in the POS system
 */
export async function deactivatePosProductAction(
  config: PosConnectionConfig,
  product: Product
): Promise<OperationResult> {
  try {
    return await posService.deactivateProduct(config, product);
  } catch (error: any) {
    console.error("[deactivatePosProductAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to deactivate product",
      errors: [error],
    };
  }
}

/**
 * Sync products from POS system
 */
export async function syncPosProductsAction(
  config: PosConnectionConfig,
  userId: string
): Promise<SyncResult> {
  if (!userId) {
    return {
      success: false,
      message: "User not authenticated",
    };
  }

  try {
    console.log(`[syncPosProductsAction] Starting sync for user ${userId}`);
    return await posService.syncProducts(config);
  } catch (error: any) {
    console.error("[syncPosProductsAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to sync products",
      errors: [error],
    };
  }
}

// --- Supplier Actions ---

/**
 * Create or update a supplier in the POS system
 */
export async function createOrUpdatePosSupplierAction(
  config: PosConnectionConfig,
  supplier: Supplier
): Promise<OperationResult<{ externalId: string }>> {
  try {
    return await posService.createOrUpdateSupplier(config, supplier);
  } catch (error: any) {
    console.error("[createOrUpdatePosSupplierAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to create/update supplier",
      errors: [error],
    };
  }
}

/**
 * Sync suppliers from POS system
 */
export async function syncPosSuppliersAction(
  config: PosConnectionConfig,
  userId: string
): Promise<SyncResult> {
  if (!userId) {
    return {
      success: false,
      message: "User not authenticated",
    };
  }

  try {
    console.log(`[syncPosSuppliersAction] Starting sync for user ${userId}`);
    return await posService.syncSuppliers(config);
  } catch (error: any) {
    console.error("[syncPosSuppliersAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to sync suppliers",
      errors: [error],
    };
  }
}

// --- Document Actions ---

/**
 * Create a document in the POS system
 */
export async function createPosDocumentAction(
  config: PosConnectionConfig,
  document: PosDocument,
  supplier: Supplier
): Promise<OperationResult<{ externalId: string }>> {
  try {
    return await posService.createDocument(config, document, supplier);
  } catch (error: any) {
    console.error("[createPosDocumentAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to create document",
      errors: [error],
    };
  }
}

/**
 * Sync documents from POS system
 */
export async function syncPosDocumentsAction(
  config: PosConnectionConfig,
  userId: string
): Promise<SyncResult> {
  if (!userId) {
    return {
      success: false,
      message: "User not authenticated",
    };
  }

  try {
    console.log(`[syncPosDocumentsAction] Starting sync for user ${userId}`);
    return await posService.syncDocuments(config);
  } catch (error: any) {
    console.error("[syncPosDocumentsAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to sync documents",
      errors: [error],
    };
  }
}

// --- Sales Actions ---

/**
 * Sync sales from POS system
 */
export async function syncPosSalesAction(
  config: PosConnectionConfig,
  userId: string
): Promise<SyncResult> {
  if (!userId) {
    return {
      success: false,
      message: "User not authenticated",
    };
  }

  try {
    console.log(`[syncPosSalesAction] Starting sync for user ${userId}`);
    return await posService.syncSales(config);
  } catch (error: any) {
    console.error("[syncPosSalesAction] Error:", error);
    return {
      success: false,
      message: error.message || "Failed to sync sales",
      errors: [error],
    };
  }
}

// --- Backward Compatibility Aliases ---
// These maintain compatibility with existing code while transitioning

export const syncInventoryAction = syncPosProductsAction;
export const syncSalesAction = syncPosSalesAction;