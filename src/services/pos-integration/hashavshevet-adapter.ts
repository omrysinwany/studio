/**
 * @fileOverview Placeholder implementation for the Hashavshevet POS/ERP system adapter.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
import { testHashavshevetConnectionAction, syncHashavshevetProductsAction, syncHashavshevetSalesAction } from '@/actions/hashavshevet-actions';

class HashavshevetAdapter implements IPosSystemAdapter {
  readonly systemId = 'hashavshevet';
  readonly systemName = 'Hashavshevet (חשבשבת)';

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[HashavshevetAdapter] Testing connection via server action with config:`, config);
    try {
      const result = await testHashavshevetConnectionAction(config);
      console.log(`[HashavshevetAdapter] Connection test result from server action:`, result);
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling test connection server action:", error);
      return { success: false, message: `Failed to execute test connection: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting product sync via server action...`);
    try {
      const result = await syncHashavshevetProductsAction(config);
      console.log(`[HashavshevetAdapter] Product sync result from server action:`, result);
      // Products (including salePrice if available) are in result.products
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling product sync server action:", error);
      return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting sales sync via server action...`);
    try {
      const result = await syncHashavshevetSalesAction(config);
      console.log(`[HashavshevetAdapter] Sales sync result from server action:`, result);
      return result;
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error calling sales sync server action:", error);
      return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }
}

export const hashavshevetAdapter = new HashavshevetAdapter();
