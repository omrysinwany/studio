'use server';

import { syncCaspitProductsAction } from '@/actions/caspit-actions'; // Action to fetch products from Caspit
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';

/**
 * Server action to manually trigger inventory sync for a specific POS system using provided config.
 * Fetches products from the POS and returns them. Saving happens on the client-side
 * because the current backend service uses localStorage.
 * @param config The POS connection configuration.
 * @param systemId The ID of the POS system (used to determine which sync action to call).
 * @returns A promise resolving to the SyncResult from the product sync operation.
 */
export async function syncInventoryAction(config: PosConnectionConfig, systemId: string): Promise<SyncResult> {
    console.log(`[syncInventoryAction] Starting manual sync for ${systemId}...`);

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
            // case 'hashavshevet':
            //     console.log(`[syncInventoryAction] Calling syncHashavshevetProductsAction with config...`);
            //     productSyncResult = await syncHashavshevetProductsAction(config); // Assuming this exists
            //     break;
            default:
                 return { success: false, message: `Manual sync currently not supported for ${systemId}.` };
        }


        console.log(`[syncInventoryAction] Raw product sync result for ${systemId}:`, productSyncResult);

        // 3. Return the result (including products if fetched) to the client.
        // The client will handle saving the products using `saveProducts`.
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

    // Note on Scheduled Sync:
    // A real scheduled daily sync (like a cron job) cannot be reliably implemented
    // purely within a standard Next.js deployment model (especially serverless).
    // This typically requires:
    // 1. An external scheduling service (e.g., Vercel Cron Jobs, Google Cloud Scheduler, AWS EventBridge).
    // 2. An API endpoint (e.g., a Next.js API route or another backend service) that the scheduler calls.
    // 3. This endpoint would then execute logic similar to this server action.
    // The simulation here focuses on the manual trigger and the core sync logic.
}
