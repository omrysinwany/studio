'use server';

import { syncCaspitProductsAction, syncCaspitSalesAction } from '@/actions/caspit-actions';
import { syncHashavshevetProductsAction, syncHashavshevetSalesAction } from '@/actions/hashavshevet-actions';
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';

/**
 * Server action to manually trigger inventory sync for a specific POS system using provided config.
 * Fetches products from the POS and returns them. Saving happens on the client-side.
 * @param config The POS connection configuration.
 * @param systemId The ID of the POS system (used to determine which sync action to call).
 * @param userId The ID of the authenticated user initiating the sync.
 * @returns A promise resolving to the SyncResult from the product sync operation.
 */
export async function syncInventoryAction(
    config: PosConnectionConfig,
    systemId: string,
    userId?: string
): Promise<SyncResult> {
    console.log(`[syncInventoryAction] Starting manual inventory sync for ${systemId} by user ${userId || 'unknown'}...`);

    if (!userId) {
        console.error("[syncInventoryAction] User not authenticated for sync operation.");
        return { success: false, message: "User not authenticated. Please log in to perform this action." };
    }

    if (!config || Object.keys(config).length === 0) {
        return { success: false, message: `POS configuration for ${systemId} is missing or empty.` };
    }

    try {
        let productSyncResult: SyncResult;

        switch (systemId) {
            case 'caspit':
                console.log(`[syncInventoryAction] Calling syncCaspitProductsAction with config...`);
                productSyncResult = await syncCaspitProductsAction(config);
                break;
            case 'hashavshevet':
                console.log(`[syncInventoryAction] Calling syncHashavshevetProductsAction with config...`);
                productSyncResult = await syncHashavshevetProductsAction(config);
                break;
            default:
                 return { success: false, message: `Inventory sync currently not supported for ${systemId}.` };
        }

        console.log(`[syncInventoryAction] Raw product sync result for ${systemId}:`, productSyncResult);

        if (!productSyncResult.success) {
             console.error(`[syncInventoryAction] Failed to fetch products from ${systemId}: ${productSyncResult.message}`);
        } else {
             console.log(`[syncInventoryAction] Successfully fetched ${productSyncResult.itemsSynced ?? 0} products from ${systemId}.`);
        }

        return productSyncResult;

    } catch (error: any) {
        console.error(`[syncInventoryAction] Error during inventory sync execution for ${systemId}:`, error);
        return { success: false, message: `Inventory sync action failed unexpectedly: ${error.message || 'Unknown error'}` };
    }
}

/**
 * Server action to manually trigger sales sync for a specific POS system using provided config.
 * @param config The POS connection configuration.
 * @param systemId The ID of the POS system.
 * @param userId The ID of the authenticated user.
 * @returns A promise resolving to the SyncResult from the sales sync operation.
 */
export async function syncSalesAction(
    config: PosConnectionConfig,
    systemId: string,
    userId?: string
): Promise<SyncResult> {
    console.log(`[syncSalesAction] Starting manual sales sync for ${systemId} by user ${userId || 'unknown'}...`);

    if (!userId) {
        console.error("[syncSalesAction] User not authenticated for sales sync operation.");
        return { success: false, message: "User not authenticated. Please log in to perform this action." };
    }

    if (!config || Object.keys(config).length === 0) {
        return { success: false, message: `POS configuration for ${systemId} is missing or empty.` };
    }

    try {
        let salesSyncResult: SyncResult;

        switch (systemId) {
            case 'caspit':
                console.log(`[syncSalesAction] Calling syncCaspitSalesAction with config...`);
                salesSyncResult = await syncCaspitSalesAction(config);
                break;
            case 'hashavshevet':
                console.log(`[syncSalesAction] Calling syncHashavshevetSalesAction with config...`);
                salesSyncResult = await syncHashavshevetSalesAction(config);
                break;
            default:
                 return { success: false, message: `Sales sync currently not supported for ${systemId}.` };
        }

        console.log(`[syncSalesAction] Raw sales sync result for ${systemId}:`, salesSyncResult);
        return salesSyncResult;

    } catch (error: any) {
        console.error(`[syncSalesAction] Error during sales sync execution for ${systemId}:`, error);
        return { success: false, message: `Sales sync action failed unexpectedly: ${error.message || 'Unknown error'}` };
    }
}
