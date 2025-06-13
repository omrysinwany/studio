"use server";

import type { PosConnectionConfig } from "@/services/pos-integration/pos-adapter.interface";
import type { Product, Supplier, InvoiceHistoryItem } from "@/services/types";

// Import all specific POS actions
import * as caspitActions from "./caspit-actions";
// import * as retalixActions from './retalix-actions'; // Example for the future

// --- Generic Result Types ---
// These types define the data structure that the backend services will always receive,
// regardless of which POS system returned the data.

export interface PosActionResult {
  success: boolean;
  message?: string;
}

export interface PosContactResult extends PosActionResult {
  externalAccountId?: string | null;
}

export interface PosProductResult extends PosActionResult {
  externalId?: string | null;
}

export interface PosDocumentResult extends PosActionResult {
  externalPurchaseDocId?: string | null;
}

// --- Dispatcher Functions ---
// These functions are the public API for the backend. They take generic app-level
// data, figure out which POS system to call, call it, and then "translate"
// the POS-specific response back into a generic response.

/**
 * Creates or updates a contact (supplier) in the currently configured POS system.
 */
export async function createOrUpdatePosContactAction(
  posConfig: PosConnectionConfig,
  supplierData: Supplier
): Promise<PosContactResult> {
  switch (posConfig.systemId) {
    case "caspit":
      const caspitResult =
        await caspitActions.createOrUpdateCaspitContactAction(
          posConfig,
          supplierData
        );
      // Translate Caspit-specific result to the generic result
      return {
        success: caspitResult.success,
        message: caspitResult.message,
        externalAccountId: caspitResult.caspitAccountId,
      };
    // case "retalix":
    //   // const retalixResult = await retalixActions.createOrUpdateRetalixContactAction(...)
    //   // return { success: ..., externalAccountId: retalixResult.retalixId };
    default:
      console.warn(
        `[pos-dispatcher] No action found for systemId: ${posConfig.systemId}`
      );
      return { success: false, message: "POS system not supported" };
  }
}

/**
 * Creates or updates a product in the currently configured POS system.
 */
export async function createOrUpdatePosProductAction(
  posConfig: PosConnectionConfig,
  productData: Product
): Promise<PosProductResult> {
  switch (posConfig.systemId) {
    case "caspit":
      const caspitResult =
        await caspitActions.createOrUpdateCaspitProductAction(
          posConfig,
          productData
        );
      return {
        success: caspitResult.success,
        message: caspitResult.message,
        externalId: caspitResult.caspitProductId,
      };
    default:
      return { success: false, message: "POS system not supported" };
  }
}

/**
 * Updates an existing product in the currently configured POS system.
 */
export async function updatePosProductAction(
  posConfig: PosConnectionConfig,
  productData: Product
): Promise<PosActionResult> {
  switch (posConfig.systemId) {
    case "caspit":
      return caspitActions.updateCaspitProductAction(posConfig, productData);
    default:
      return { success: false, message: "POS system not supported" };
  }
}

/**
 * Deactivates a product in the currently configured POS system.
 */
export async function deactivatePosProductAction(
  posConfig: PosConnectionConfig,
  productData: Product
): Promise<PosActionResult> {
  switch (posConfig.systemId) {
    case "caspit":
      return caspitActions.deactivateCaspitProductAction(
        posConfig,
        productData
      );
    default:
      return { success: false, message: "POS system not supported" };
  }
}

/**
 * Creates a purchase document (invoice) in the currently configured POS system.
 */
export async function createPosDocumentAction(
  posConfig: PosConnectionConfig,
  invoiceData: InvoiceHistoryItem,
  products: Product[],
  externalContactId: string
): Promise<PosDocumentResult> {
  switch (posConfig.systemId) {
    case "caspit":
      const caspitResult = await caspitActions.createCaspitDocumentAction(
        posConfig,
        invoiceData,
        products,
        externalContactId
      );
      return {
        success: caspitResult.success,
        message: caspitResult.message,
        externalPurchaseDocId: caspitResult.caspitPurchaseDocId,
      };
    default:
      return { success: false, message: "POS system not supported" };
  }
}
