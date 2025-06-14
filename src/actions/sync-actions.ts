'use server';

import { posService } from '@/services/pos-integration/pos-service';
import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';

/**
 * Server action to manually trigger inventory sync for a specific POS system using provided config.
 * Fetches products from the POS and returns them. Saving happens on the client-side.
 * @param config The POS connection configuration (must include systemId).
 * @param systemId The ID of the POS system (legacy parameter, prefer using config.systemId).
 * @param userId The ID of the authenticated user initiating the sync.
 * @returns A promise resolving to the SyncResult from the product sync operation.
 */
export async function syncInventoryAction(
    config: PosConnectionConfig,
    systemId: string,
    userId?: string
): Promise<SyncResult> {
    // Ensure systemId is in config
    const configWithSystemId = { ...config, systemId: systemId || config.systemId };
    
    console.log(`[syncInventoryAction] Starting manual inventory sync for ${configWithSystemId.systemId} by user ${userId || 'unknown'}...`);

    if (!userId) {
        console.error("[syncInventoryAction] User not authenticated for sync operation.");
        return { success: false, message: "User not authenticated. Please log in to perform this action." };
    }

    if (!configWithSystemId.systemId) {
        return { success: false, message: "POS system ID is missing." };
    }

    if (!config || Object.keys(config).length === 0) {
        return { success: false, message: `POS configuration for ${configWithSystemId.systemId} is missing or empty.` };
    }

    try {
        console.log(`[syncInventoryAction] Calling posService.syncProducts with config...`);
        const productSyncResult = await posService.syncProducts(configWithSystemId);
        
        console.log(`[syncInventoryAction] Raw product sync result for ${configWithSystemId.systemId}:`, productSyncResult);

        if (!productSyncResult.success) {
             console.error(`[syncInventoryAction] Failed to fetch products from ${configWithSystemId.systemId}: ${productSyncResult.message}`);
        } else {
             console.log(`[syncInventoryAction] Successfully fetched ${productSyncResult.itemsSynced ?? 0} products from ${configWithSystemId.systemId}.`);
        }

        return productSyncResult;

    } catch (error: any) {
        console.error(`[syncInventoryAction] Error during inventory sync execution for ${configWithSystemId.systemId}:`, error);
        return { success: false, message: `Inventory sync action failed unexpectedly: ${error.message || 'Unknown error'}` };
    }
}

/**
 * Server action to manually trigger sales sync for a specific POS system using provided config.
 * @param config The POS connection configuration (must include systemId).
 * @param systemId The ID of the POS system (legacy parameter, prefer using config.systemId).
 * @param userId The ID of the authenticated user.
 * @returns A promise resolving to the SyncResult from the sales sync operation.
 */
export async function syncSalesAction(
    config: PosConnectionConfig,
    systemId: string,
    userId?: string
): Promise<SyncResult> {
    // Ensure systemId is in config
    const configWithSystemId = { ...config, systemId: systemId || config.systemId };
    
    console.log(`[syncSalesAction] Starting manual sales sync for ${configWithSystemId.systemId} by user ${userId || 'unknown'}...`);

    if (!userId) {
        console.error("[syncSalesAction] User not authenticated for sales sync operation.");
        return { success: false, message: "User not authenticated. Please log in to perform this action." };
    }

    if (!configWithSystemId.systemId) {
        return { success: false, message: "POS system ID is missing." };
    }

    if (!config || Object.keys(config).length === 0) {
        return { success: false, message: `POS configuration for ${configWithSystemId.systemId} is missing or empty.` };
    }

    try {
        console.log(`[syncSalesAction] Calling posService.syncSales with config...`);
        const salesSyncResult = await posService.syncSales(configWithSystemId);
        
        console.log(`[syncSalesAction] Raw sales sync result for ${configWithSystemId.systemId}:`, salesSyncResult);
        return salesSyncResult;

    } catch (error: any) {
        console.error(`[syncSalesAction] Error during sales sync execution for ${configWithSystemId.systemId}:`, error);
        return { success: false, message: `Sales sync action failed unexpectedly: ${error.message || 'Unknown error'}` };
    }
}
