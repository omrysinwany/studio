/**
 * @fileOverview Manages different POS system adapters.
 * This allows selecting and using the correct adapter based on configuration.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult } from './pos-adapter.interface';
import { caspitAdapter } from './caspit-adapter';
// Import other adapters here as they are created
// import { retalixAdapter } from './retalix-adapter';

// List of available adapters
const availableAdapters: Record<string, IPosSystemAdapter> = {
  [caspitAdapter.systemId]: caspitAdapter,
  // [retalixAdapter.systemId]: retalixAdapter,
};

/**
 * Gets the list of available POS systems for configuration.
 * @returns An array of objects containing systemId and systemName.
 */
export function getAvailablePosSystems(): { systemId: string; systemName: string }[] {
  return Object.values(availableAdapters).map(adapter => ({
    systemId: adapter.systemId,
    systemName: adapter.systemName,
  }));
}

/**
 * Gets a specific POS adapter by its system ID.
 * @param systemId - The unique identifier of the POS system.
 * @returns The adapter instance, or null if not found.
 */
export function getPosAdapter(systemId: string): IPosSystemAdapter | null {
  return availableAdapters[systemId] || null;
}

/**
 * Tests the connection for the specified POS system using its adapter or action.
 * @param systemId - The ID of the POS system to test.
 * @param config - The connection configuration.
 * @returns A promise resolving to true if the connection is successful, false otherwise.
 */
export async function testPosConnection(systemId: string, config: PosConnectionConfig): Promise<boolean> {
  const adapter = getPosAdapter(systemId);
  if (!adapter) {
    console.error(`[IntegrationManager] Adapter not found for systemId: ${systemId}`);
    // Optionally throw an error or return false depending on desired behavior
    throw new Error(`Adapter not found for system: ${systemId}`);
    // return false;
  }
  try {
     // The adapter's testConnection method now calls the server action and returns its boolean result
    const isSuccess = await adapter.testConnection(config);
    console.log(`[IntegrationManager] Connection test result for ${systemId}: ${isSuccess}`);
    return isSuccess;
  } catch (error) {
    // This catch block might still be useful if the adapter itself throws an error before calling the action
    console.error(`[IntegrationManager] Error testing connection for ${systemId}:`, error);
    return false; // Return false on any error during the test process
  }
}

/**
 * Placeholder function to trigger synchronization for the currently configured POS system.
 * @param systemId - The ID of the POS system to sync.
 * @param config - The connection configuration.
 * @param syncType - The type of sync to perform ('products', 'sales', 'all').
 * @returns A promise resolving to an array of SyncResult objects (one for each sync type).
 */
export async function syncWithPos(systemId: string, config: PosConnectionConfig, syncType: 'products' | 'sales' | 'all'): Promise<SyncResult[]> {
  const adapter = getPosAdapter(systemId);
  if (!adapter) {
    const errorResult = { success: false, message: `Adapter not found for systemId: ${systemId}` };
    return [errorResult];
  }

  const results: SyncResult[] = [];

  try {
    if (syncType === 'products' || syncType === 'all') {
      const productResult = await adapter.syncProducts(config);
      results.push(productResult);
    }
    if (syncType === 'sales' || syncType === 'all') {
      const salesResult = await adapter.syncSales(config);
      results.push(salesResult);
    }
  } catch (error: any) {
     console.error(`[IntegrationManager] Error during sync for ${systemId}:`, error);
     results.push({ success: false, message: `Sync failed: ${error.message || 'Unknown error'}` });
  }

  return results;
}

