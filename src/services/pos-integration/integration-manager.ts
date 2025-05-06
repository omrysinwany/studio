/**
 * @fileOverview Manages different POS system adapters.
 * This allows selecting and using the correct adapter based on configuration.
 */

import type { IPosSystemAdapter, PosConnectionConfig, SyncResult } from './pos-adapter.interface';
import { caspitAdapter } from './caspit-adapter';
import { hashavshevetAdapter } from './hashavshevet-adapter'; // Import the new adapter
// Import other adapters here as they are created
// import { retalixAdapter } from './retalix-adapter';

// List of available adapters
const availableAdapters: Record<string, IPosSystemAdapter> = {
  [caspitAdapter.systemId]: caspitAdapter,
  [hashavshevetAdapter.systemId]: hashavshevetAdapter, // Register Hashavshevet adapter
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
 * @returns A promise resolving to an object { success: boolean, message: string }.
 */
export async function testPosConnection(systemId: string, config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
  const adapter = getPosAdapter(systemId);
  if (!adapter) {
    const errorMsg = `Adapter not found for system: ${systemId}`;
    console.error(`[IntegrationManager] ${errorMsg}`);
    // Return a failure object
    return { success: false, message: errorMsg };
    // Or throw if preferred: throw new Error(errorMsg);
  }
  try {
     // The adapter's testConnection method now calls the server action and should return { success, message }
    const result = await adapter.testConnection(config);
    console.log(`[IntegrationManager] Connection test result for ${systemId}:`, result);
    return result; // Return the full result object
  } catch (error: any) {
    // This catch block might still be useful if the adapter itself throws an error before calling the action
    const errorMsg = `Error testing connection for ${systemId}: ${error.message || 'Unknown error'}`;
    console.error(`[IntegrationManager] ${errorMsg}`);
    return { success: false, message: errorMsg }; // Return a failure object on error
  }
}

// Removed syncWithPos function - sync logic is now handled by specific actions (e.g., syncInventoryAction)
// and triggered from the UI (e.g., PosIntegrationSettingsPage).
// Scheduled sync needs external infrastructure (cron jobs + API endpoint).
