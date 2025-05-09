'use server';

import { syncCaspitProductsAction } from '@/actions/caspit-actions';
import { syncHashavshevetProductsAction } from '@/actions/hashavshevet-actions';
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';

/**
 * Server action to manually trigger inventory sync for a specific POS system using provided config.
 * Fetches products from the POS and returns them. Saving happens on the client-side
 * because the current backend service uses localStorage.
 * @param config The POS connection configuration.
 * @param systemId The ID of the POS system (used to determine which sync action to call).
 * @param userId The ID of the authenticated user initiating the sync.
 * @returns A promise resolving to the SyncResult from the product sync operation.
 */
export async function syncInventoryAction(
    config: PosConnectionConfig,
    systemId: string,
    userId?: string // Added userId for authentication check
): Promise<SyncResult> {
    console.log(`[syncInventoryAction] Starting manual sync for ${systemId} by user ${userId || 'unknown'}...`);

    // Authentication check
    if (!userId) {
        console.error("[syncInventoryAction] User not authenticated for sync operation.");
        return { success: false, message: "User not authenticated. Please log in to perform this action." };
    }

    // Validate config
    if (!config || Object.keys(config).length === 0) {
        return { success: false, message: `POS configuration for ${systemId} is missing or empty.` };
    }

    try {
        let productSyncResult: SyncResult;

        // Determine which action to call based on systemId
        switch (systemId) {
            case 'caspit':
                console.log(`[syncInventoryAction] Calling syncCaspitProductsAction with config...`);
                productSyncResult = await syncCaspitProductsAction(config);
                break;
            case 'hashavshevet': // Ensure Hashavshevet case is handled
                console.log(`[syncInventoryAction] Calling syncHashavshevetProductsAction with config...`);
                productSyncResult = await syncHashavshevetProductsAction(config);
                break;
            default:
                 return { success: false, message: `Manual sync currently not supported for ${systemId}.` };
        }


        console.log(`[syncInventoryAction] Raw product sync result for ${systemId}:`, productSyncResult);

        // 3. Return the result (including products if fetched) to the client.
        // The client will handle saving the products using `finalizeSaveProductsService`.
        if (!productSyncResult.success) {
             console.error(`[syncInventoryAction] Failed to fetch products from ${systemId}: ${productSyncResult.message}`);
        } else {
             console.log(`[syncInventoryAction] Successfully fetched ${productSyncResult.itemsSynced ?? 0} products from ${systemId}.`);
        }

        return productSyncResult;

    } catch (error: any) {
        console.error(`[syncInventoryAction] Error during sync execution for ${systemId}:`, error);
        return { success: false, message: `Sync action failed unexpectedly: ${error.message || 'Unknown error'}` };
    }
}
