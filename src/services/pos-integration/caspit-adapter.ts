/**
 * @fileOverview Implementation for the Caspit POS system adapter.
 * Leverages server actions for API communication.
 */

import type {
  IPosSystemAdapter,
  PosConnectionConfig,
  SyncResult,
} from "./pos-adapter.interface";
import {
  testCaspitConnectionAction,
  syncCaspitProductsAction,
  syncCaspitSalesAction,
  syncCaspitSuppliersAction,
  syncCaspitDocumentsAction,
} from "@/actions/caspit-actions";

class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = "caspit";
  readonly systemName = "Caspit (כספית)";

  // --- Connection Test ---
  async testConnection(
    config: PosConnectionConfig
  ): Promise<{ success: boolean; message: string }> {
    console.log(
      `[CaspitAdapter] Testing connection via server action with config:`,
      config
    );
    try {
      const result = await testCaspitConnectionAction(config);
      console.log(
        `[CaspitAdapter] Connection test result from server action:`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        "[CaspitAdapter] Error calling test connection server action:",
        error
      );
      return {
        success: false,
        message: `Failed to execute test connection: ${
          error.message || "Unknown error"
        }`,
      };
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting product sync via server action...`);
    try {
      const result = await syncCaspitProductsAction(config);
      console.log(
        `[CaspitAdapter] Product sync result from server action:`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        "[CaspitAdapter] Error calling product sync server action:",
        error
      );
      return {
        success: false,
        message: `Product sync failed: ${error.message || "Unknown error"}`,
      };
    }
  }

  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync via server action...`);
    try {
      const result = await syncCaspitSalesAction(config);
      console.log(
        `[CaspitAdapter] Sales sync result from server action:`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        "[CaspitAdapter] Error calling sales sync server action:",
        error
      );
      return {
        success: false,
        message: `Sales sync failed: ${error.message || "Unknown error"}`,
      };
    }
  }

  // --- Supplier Sync ---
  async syncSuppliers(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting supplier sync via server action...`);
    try {
      const result = await syncCaspitSuppliersAction(config);
      console.log(
        `[CaspitAdapter] Supplier sync result from server action:`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        "[CaspitAdapter] Error calling supplier sync server action:",
        error
      );
      return {
        success: false,
        message: `Supplier sync failed: ${error.message || "Unknown error"}`,
      };
    }
  }

  // --- Document Sync ---
  async syncDocuments(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting document sync via server action...`);
    try {
      const result = await syncCaspitDocumentsAction(config);
      console.log(
        `[CaspitAdapter] Document sync result from server action:`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        "[CaspitAdapter] Error calling document sync server action:",
        error
      );
      return {
        success: false,
        message: `Document sync failed: ${error.message || "Unknown error"}`,
      };
    }
  }
}

export const caspitAdapter = new CaspitAdapter();
