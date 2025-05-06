'use server';

import { getPosSettings } from '@/services/backend';
import { syncCaspitProductsAction } from '@/actions/caspit-actions'; // Action to fetch products from Caspit
import type { SyncResult } from '@/services/pos-integration/pos-adapter.interface';

/**
 * Server action to manually trigger inventory sync for a specific POS system.
 * Fetches products from the POS and returns them. Saving happens on the client-side
 * because the current backend service uses localStorage.
 * @param systemId The ID of the POS system to sync (e.g., 'caspit').
 * @returns A promise resolving to the SyncResult from the product sync operation.
 */
export async function syncInventoryAction(systemId: string): Promise<SyncResult> {
    console.log(`[syncInventoryAction] Starting manual sync for ${systemId}...`);

    // Currently only implemented for Caspit
    if (systemId !== 'caspit') {
        return { success: false, message: `Manual sync currently only supports Caspit.` };
    }

    try {
        // 1. Get POS Settings
        const settings = await getPosSettings();
        if (!settings || settings.systemId !== systemId || !settings.config) {
            return { success: false, message: `POS settings for ${systemId} not configured or incomplete.` };
        }

        // 2. Call the specific action to fetch products from Caspit
        // This action handles authentication and API calls to Caspit.
        const productSyncResult = await syncCaspitProductsAction(settings.config);

        console.log(`[syncInventoryAction] Raw product sync result for ${systemId}:`, productSyncResult);

        // 3. Return the result (including products if fetched) to the client.
        // The client will handle saving the products using `saveProducts`.
        if (!productSyncResult.success) {
             console.error(`[syncInventoryAction] Failed to fetch products from Caspit: ${productSyncResult.message}`);
        } else {
             console.log(`[syncInventoryAction] Successfully fetched ${productSyncResult.itemsSynced ?? 0} products from Caspit.`);
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
