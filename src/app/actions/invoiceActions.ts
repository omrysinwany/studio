"use server";

import { getPosAdapter } from "@/services/pos-integration/integration-manager";
import { getUserSettingsService } from "@/services/backend-server";

/**
 * Synchronizes an invoice with the configured Point of Sale (POS) system.
 *
 * This server action retrieves the user's POS configuration, instantiates the
 * appropriate POS adapter, and then calls the adapter's syncInvoice method.
 *
 * @param {string} userId - The ID of the user performing the action.
 * @param {string} invoiceId - The ID of the invoice to be synchronized.
 * @returns {Promise<{ success: boolean; message: string }>} - A promise that resolves to an object
 * indicating the outcome of the operation.
 */
export async function syncInvoiceToPos(userId: string, invoiceId: string) {
  try {
    const settings = await getUserSettingsService(userId);
    const systemId = settings?.posConfig?.posSystemId;

    if (!systemId) {
      // This is not an error, the user might just not have a POS configured.
      console.log(
        `User ${userId} does not have a POS system configured. Skipping sync.`
      );
      return {
        success: true,
        message: "No POS system configured. Sync skipped.",
      };
    }

    const posAdapter = getPosAdapter(systemId);

    if (!posAdapter) {
      throw new Error(`POS adapter for system ID '${systemId}' not found.`);
    }

    const result = await posAdapter.syncInvoice(userId, invoiceId);

    if (result.success) {
      console.log(`Successfully synced invoice ${invoiceId} to ${systemId}`);
      return {
        success: true,
        message:
          result.message || `Invoice synced successfully to ${systemId}.`,
      };
    } else {
      console.error(
        `Failed to sync invoice ${invoiceId} to ${systemId}:`,
        result.message
      );
      return {
        success: false,
        message: result.message || "Unknown error during sync.",
      };
    }
  } catch (error) {
    console.error("Error in syncInvoiceToPos server action:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { success: false, message: errorMessage };
  }
}
