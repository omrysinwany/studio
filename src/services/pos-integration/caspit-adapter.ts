/**
 * @fileOverview Implementation for the Caspit POS system adapter using demo credentials.
 * Handles fetching products and mapping them to the InvoTrack format.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult, Product } from './pos-adapter.interface';
// Removed import { saveProducts } from '@/services/backend';
import { testCaspitConnectionAction, syncCaspitProductsAction, syncCaspitSalesAction } from '@/actions/caspit-actions'; // Import server actions

// Removed interface CaspitProduct as mapping happens in the action

class CaspitAdapter implements IPosSystemAdapter {
  readonly systemId = 'caspit';
  readonly systemName = 'Caspit (כספית)';

  // --- Authentication (handled within server actions now) ---
  // Token logic removed from adapter

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    console.log(`[CaspitAdapter] Testing connection via server action with config:`, config);
    try {
      // Directly call the server action to test the connection
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
        // Call the server action, passing the config. The action handles token fetching.
        const result = await syncCaspitProductsAction(config);
        console.log(`[CaspitAdapter] Product sync result from server action:`, result);
        return result;
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling product sync server action:", error);
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error'}` };
    }
  }


  // --- Map Caspit Product to InvoTrack Product (Removed - Logic moved to server action) ---


  // --- Sales Sync ---
  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[CaspitAdapter] Starting sales sync via server action...`);
    try {
        // Call the server action, passing the config. The action handles token fetching.
        const result = await syncCaspitSalesAction(config);
        console.log(`[CaspitAdapter] Sales sync result from server action:`, result);
        return result;
    } catch (error: any) {
        console.error("[CaspitAdapter] Error calling sales sync server action:", error);
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error'}` };
    }
  }
}

// Export a single instance of the adapter
export const caspitAdapter = new CaspitAdapter();
