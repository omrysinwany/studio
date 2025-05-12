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

    // Use demo credentials as per user's information
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
                'Accept': 'application/json, text/plain, */*' // Prefer JSON or plain text
            }
        }); 
        responseText = await response.text(); 
        console.log(`[Caspit Action - getToken] Raw response status: ${response.status}`);
        console.log(`[Caspit Action - getToken] Raw response headers:`, response.headers);
        console.log(`[Caspit Action - getToken] Raw response text START:\n---\n${responseText}\n---\nRaw response text END`);

        if (!response.ok) {
             if (responseText.includes("Invalid") || responseText.toLowerCase().includes("token error") || responseText.toLowerCase().includes("too many requests")) {
                throw new Error(`Caspit API Error (${response.status}): ${responseText}`);
             }
            throw new Error(`Caspit API Error (${response.status}): ${responseText || response.statusText}`);
        }

        let accessToken: string | null = null;
        
        // Try to parse as JSON first, as Caspit's OpenAPI docs show JSON for OpenAPIToken endpoint
        if (responseText.trim().startsWith('{')) {
             try {
                const data = JSON.parse(responseText);
                // Check for common token field names (case-insensitive for robustnes, then specific)
                accessToken = data?.AccessToken || data?.accessToken || data?.Token || data?.token;
                if (!accessToken && typeof data === 'object' && data !== null) {
                    // Fallback: iterate keys if specific names fail
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
                     console.warn('[Caspit Action - getToken] JSON parsed, but no token field (AccessToken, accessToken, Token, token) found. Checking if response IS the token itself.');
                     // If JSON parsing succeeded but no token field, check if the raw responseText itself could be the token
                     if (typeof responseText === 'string' && responseText.length > 20 && !responseText.includes(" ") && !responseText.includes("<") && !responseText.includes("{")) {
                         accessToken = responseText.trim().replace(/^"+|"+$/g, '');
                         console.log('[Caspit Action - getToken] Interpreted raw response as plain text token after failed JSON key lookup.');
                     } else {
                         // Throw error if JSON parsed but no usable token field and not a plain token string
                         throw new Error('JSON response did not contain a valid AccessToken or token field.');
                     }
                }
             } catch (jsonError) {
                 console.warn('[Caspit Action - getToken] Failed to parse as JSON. Will attempt to treat as plain text token. Error:', jsonError);
                 // Fall through to plain text check if JSON parsing fails
             }
        }
        
        // If not parsed as JSON or JSON parsing failed, try treating as plain text token
        if (!accessToken) {
            if (typeof responseText === 'string' && responseText.length > 20 && !responseText.includes(" ") && !responseText.includes("<") && !responseText.includes("{")) {
                accessToken = responseText.trim().replace(/^"+|"+$/g, ''); // Remove surrounding quotes if any
                console.log('[Caspit Action - getToken] Interpreted response as plain text token.');
            }
        }


        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
            console.error('[Caspit Action - getToken] Failed to extract token from response. Raw Text:', responseText);
            throw new Error('Invalid token response structure from Caspit API. AccessToken missing or empty.');
        }
        
        accessToken = accessToken.replace(/^"+|"+$/g, '');


        console.log('[Caspit Action - getToken] Successfully obtained token:', accessToken);
        return accessToken;

    } catch (error: any) {
        console.error('[Caspit Action - getToken] Error fetching Caspit token:', error);
        // Ensure a clean string message is thrown
        throw new Error(`Caspit token request failed: ${error.message}. Raw Response (if available): ${responseText}`);
    }
}


// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        await getCaspitToken(config);
        return { success: true, message: 'Connection successful!' };
    } catch (error: any) {
        console.error("[Caspit Action - testConnection] Test failed:", error);
        // Ensure message is a simple string
        const errorMessage = error.message || 'Unknown error during connection test.';
        return { success: false, message: `Connection failed: ${errorMessage}` };
    }
}

// --- Map Caspit Product Data ---
 function mapCaspitProduct(caspitProduct: any): Product | null {
      const productId = caspitProduct.ProductId;
      const catalogNumber = caspitProduct.CatalogNumber || '';
      const description = caspitProduct.Name || caspitProduct.Description || '';
      const unitPrice = caspitProduct.PurchasePrice ?? 0; // Cost price
      const salePrice = caspitProduct.SalePrice1 ?? undefined; // Sale price (optional)
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
        salePrice: salePrice, // Map SalePrice1 to salePrice
        lineTotal: quantityInStock * unitPrice, // Based on cost price
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
                    'Accept': 'application/json' // Explicitly request JSON for products
                }
            });
            const responseText = await response.text();

            if (!response.ok) {
                 console.error(`[Caspit Action - syncProducts] Failed fetch for page ${currentPage}. Status: ${response.status}. Response: ${responseText}`);
                 if (response.status === 401) {
                    throw new Error(`Failed to fetch products: ${response.status} Invalid token. Token used: "${token}". Response: ${responseText}`);
                 }
                throw new Error(`Failed to fetch products: ${response.status} ${response.statusText}. Response: ${responseText}`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error(`[Caspit Action - syncProducts] Failed to parse JSON for page ${currentPage}. Response: ${responseText}`);
                throw new Error('Invalid JSON response received from Caspit product API.');
            }

            if (!data || typeof data !== 'object' || !Array.isArray(data.Results)) {
                console.error(`[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`);
                throw new Error(`Invalid product data structure received from Caspit API. Expected object with 'Results' array. Received structure: ${JSON.stringify(Object.keys(data))}. Raw response: ${responseText}`);
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
