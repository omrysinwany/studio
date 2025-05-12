// src/actions/caspit-actions.ts
'use server';

import type { PosConnectionConfig, SyncResult } from '@/services/pos-integration/pos-adapter.interface';
import type { Product } from '@/services/backend';

const CASPIT_API_BASE_URL = 'https://app.caspit.biz/api/v1';

// --- Helper function to get the Caspit API token ---
async function getCaspitToken(config: PosConnectionConfig): Promise<string> {
    const { user, pwd, osekMorshe } = config;
    if (!user || !pwd || !osekMorshe) {
        throw new Error('Missing Caspit credentials (user, pwd, osekMorshe) in configuration.');
    }

    const demoUser = 'demo';
    const demoPwd = 'demodemo';
    const demoOsekMorshe = '123456789';

    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(demoUser)}&pwd=${encodeURIComponent(demoPwd)}&osekMorshe=${encodeURIComponent(demoOsekMorshe)}`;
    console.log('[Caspit Action - getToken] Requesting token from:', url);

    let response: Response;
    let responseText = '';
    try {
        response = await fetch(url, { 
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain' 
            }
        }); 
        responseText = await response.text(); 
        console.log(`[Caspit Action - getToken] Raw response status: ${response.status}`);
        console.log(`[Caspit Action - getToken] Raw response headers:`, response.headers);
        console.log(`[Caspit Action - getToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`);

        if (!response.ok) {
             if (responseText.includes("Invalid") || responseText.toLowerCase().includes("token error") || responseText.toLowerCase().includes("too many requests")) {
                throw new Error(`Caspit API Error (${response.status}): ${responseText}`); // Keep responseText for specific known Caspit errors
             }
            // Generic error for other !response.ok cases, avoiding raw responseText in message
            throw new Error(`Caspit API request failed with status ${response.status}.`);
        }

        let accessToken: string | null = null;
        
        if (responseText.trim().startsWith('{')) {
             try {
                const data = JSON.parse(responseText);
                accessToken = data?.AccessToken || data?.accessToken || data?.Token || data?.token;
                if (!accessToken && typeof data === 'object' && data !== null) {
                    for (const key in data) {
                        if (key.toLowerCase() === 'accesstoken' || key.toLowerCase() === 'token') {
                            if (typeof data[key] === 'string' && data[key].trim() !== '') {
                                accessToken = data[key].trim();
                                break;
                            }
                        }
                    }
                }

                if (!accessToken) {
                     console.warn('[Caspit Action - getToken] JSON parsed, but no token field found. Checking if response IS the token itself.');
                     if (typeof responseText === 'string' && responseText.length > 20 && !responseText.includes(" ") && !responseText.includes("<") && !responseText.includes("{")) {
                         accessToken = responseText.trim().replace(/^"+|"+$/g, '');
                         console.log('[Caspit Action - getToken] Interpreted raw response as plain text token after failed JSON key lookup.');
                     } else {
                         // Throw simpler error if JSON parsed but no usable token field and not a plain token string
                         throw new Error('Caspit API: JSON response did not contain a valid token field.');
                     }
                }
             } catch (jsonError) {
                 console.warn('[Caspit Action - getToken] Failed to parse as JSON. Will attempt to treat as plain text token. JSON Error:', (jsonError as Error).message);
                 // Fall through to plain text check if JSON parsing fails
             }
        }
        
        if (!accessToken) {
            // More specific check for plain text token: should be a long alphanumeric string without typical sentence characters or XML/JSON structures.
            if (typeof responseText === 'string' && responseText.length >= 20 && /^[a-zA-Z0-9]+$/.test(responseText.replace(/^"+|"+$/g, ''))) {
                accessToken = responseText.trim().replace(/^"+|"+$/g, ''); 
                console.log('[Caspit Action - getToken] Interpreted response as plain text token.');
            } else {
                console.warn('[Caspit Action - getToken] Response is not valid JSON and does not look like a plain text token. Raw response logged above.');
            }
        }

        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
            console.error('[Caspit Action - getToken] Failed to extract token from response. Raw Response logged above.');
            // Simplified error message
            throw new Error('Caspit API: Invalid token response or AccessToken missing/empty.');
        }
        
        accessToken = accessToken.replace(/^"+|"+$/g, '');

        console.log('[Caspit Action - getToken] Successfully obtained token:', accessToken);
        return accessToken;

    } catch (error: any) {
        console.error('[Caspit Action - getToken] Error processing Caspit token request:', error.message);
        // Simplified error propagation
        throw new Error(`Caspit token request failed: ${error.message}`);
    }
}


// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        await getCaspitToken(config);
        return { success: true, message: 'Connection successful!' };
    } catch (error: any) {
        console.error("[Caspit Action - testConnection] Test failed:", error);
        const errorMessage = error.message || 'Unknown error during connection test.';
        return { success: false, message: `Connection failed: ${errorMessage}` };
    }
}

// --- Map Caspit Product Data ---
 function mapCaspitProduct(caspitProduct: any): Product | null {
      const productId = caspitProduct.ProductId;
      const catalogNumber = caspitProduct.CatalogNumber || '';
      const description = caspitProduct.Name || caspitProduct.Description || '';
      const unitPrice = caspitProduct.PurchasePrice ?? 0; 
      const salePrice = caspitProduct.SalePrice1 ?? undefined; 
      const quantityInStock = caspitProduct.QtyInStock ?? 0;

      if (!catalogNumber && !description) {
        console.warn('[Caspit Action - mapCaspitProduct] Skipping product due to missing catalog number and name/description:', caspitProduct);
        return null;
      }

      const invoTrackProduct: Product = {
        id: productId,
        catalogNumber: catalogNumber || 'N/A',
        description: description || 'No Description',
        quantity: quantityInStock,
        unitPrice: unitPrice,
        salePrice: salePrice, 
        lineTotal: quantityInStock * unitPrice, 
      };
      return invoTrackProduct;
}


// --- Server Action to Sync Products ---
export async function syncCaspitProductsAction(config: PosConnectionConfig): Promise<SyncResult> {
    let token: string;
    try {
        console.log('[Caspit Action - syncProducts] Fetching fresh token...');
        token = await getCaspitToken(config);
        console.log('[Caspit Action - syncProducts] Fresh token obtained for product sync.');
    } catch (error: any) {
        return { success: false, message: `Product sync failed: Could not get token - ${error.message}` };
    }

    let allProducts: Product[] = [];
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    try {
        while (hasMore) {
            const url = `${CASPIT_API_BASE_URL}/Products?token=${token}&page=${currentPage}`;
            console.log(`[Caspit Action - syncProducts] Fetching page ${currentPage}: ${url}`);
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json' 
                }
            });
            const responseText = await response.text();

            if (!response.ok) {
                 console.error(`[Caspit Action - syncProducts] Failed fetch for page ${currentPage}. Status: ${response.status}. Response: ${responseText}`);
                 if (response.status === 401) {
                    throw new Error(`Failed to fetch products: ${response.status} Invalid token. Token used: "${token}".`);
                 }
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}.`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error(`[Caspit Action - syncProducts] Failed to parse JSON for page ${currentPage}. Response: ${responseText}`);
                throw new Error('Caspit API: Invalid JSON response received from product API.');
            }

            if (!data || typeof data !== 'object' || !Array.isArray(data.Results)) {
                console.error(`[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`);
                throw new Error(`Caspit API: Invalid product data structure received. Expected object with 'Results' array.`);
            }

            const mappedProducts = data.Results
                .map(mapCaspitProduct)
                .filter((p): p is Product => p !== null);

            allProducts = allProducts.concat(mappedProducts);
            totalSynced += mappedProducts.length;

            if (data.TotalPages && currentPage < data.TotalPages && data.NextPageUrl) {
                 currentPage++;
            } else {
                hasMore = false;
            }
            if (currentPage > (data.TotalPages || 50)) { 
                 console.warn(`[Caspit Action - syncProducts] Reached page limit (${currentPage}). Stopping sync.`);
                 hasMore = false;
            }
        }

        console.log(`[Caspit Action - syncProducts] Returning ${totalSynced} products.`);
        return {
            success: true,
            message: `Successfully fetched ${totalSynced} products from Caspit.`,
            itemsSynced: totalSynced,
            products: allProducts 
        };

    } catch (error: any) {
        console.error("[Caspit Action - syncProducts] Product sync failed:", error);
        const errorMessage = error.message || 'Unknown error during product sync.';
        return { success: false, message: `Product sync failed: ${errorMessage}` };
    }
}


// --- Server Action to Sync Sales ---
export async function syncCaspitSalesAction(config: PosConnectionConfig): Promise<SyncResult> {
    let token: string;
    try {
        console.log('[Caspit Action - syncSales] Fetching fresh token...');
        token = await getCaspitToken(config);
        console.log('[Caspit Action - syncSales] Fresh token obtained for sales sync.');
    } catch (error: any) {
        return { success: false, message: `Sales sync failed: Could not get token - ${error.message}` };
    }

    console.log("[Caspit Action - syncSales] Placeholder for sales sync...");
     try {
        // TODO: Implement actual sales sync logic with Caspit API, using the token.
        // Remember to request 'Accept: application/json' header.
        return { success: true, message: "Sales sync placeholder completed." };
    } catch (error: any) {
        console.error("[Caspit Action - syncSales] Error during sales sync:", error);
         if (error instanceof Error && error.message.includes('401')) {
             return { success: false, message: `Sales sync failed: Invalid token. ${error.message}` };
         }
        const errorMessage = error.message || 'Unknown error during sales sync.';
        return { success: false, message: `Sales sync failed: ${errorMessage}` };
    }
}
