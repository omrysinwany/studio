/**
 * @fileOverview Implementation for the Caspit POS system adapter using demo credentials.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
import { testCaspitConnectionAction, syncCaspitProductsAction, syncCaspitSalesAction } from '@/actions/caspit-actions';

class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = 'caspit';
  readonly systemName = 'Caspit (כספית)';

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[CaspitAdapter] Testing connection via server action with config:`, config);
    try {
      const result = await testCaspitConnectionAction(config);
      console.log(`[CaspitAdapter] Connection test result from server action:`, result);
      return result;
    } catch (error: any) {
      console.error("[CaspitAdapter] Error calling test connection server action:", error);
      return { success: false, message: `Failed to execute test connection: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Product Sync ---
  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting product sync via server action...`);
    try {
        const result = await syncCaspitProductsAction(config);
        console.log(`[CaspitAdapter] Product sync result from server action:`, result);
        // Products (including salePrice if available from Caspit) are in result.products
        // Saving is handled on the client-side after the action returns.
        return result;
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling product sync server action:", error);
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }

  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync via server action...`);
    try {
        const result = await syncCaspitSalesAction(config);
        console.log(`[CaspitAdapter] Sales sync result from server action:`, result);
        return result;
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling sales sync server action:", error);
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }
}

export const caspitAdapter = new CaspitAdapter();
