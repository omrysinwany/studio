
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

    // Use demo credentials if actual ones are not fully provided or for testing
    const effectiveUser = user || 'demo';
    const effectivePwd = pwd || 'demodemo';
    const effectiveOsekMorshe = osekMorshe || '123456789';


    const url = `${CASPIT_API_BASE_URL}/Token?user=${encodeURIComponent(effectiveUser)}&pwd=${encodeURIComponent(effectivePwd)}&osekMorshe=${encodeURIComponent(effectiveOsekMorshe)}`;
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
            const genericApiError = `Caspit API request failed with status ${response.status}.`;
            console.error(`[Caspit Action - getToken] ${genericApiError} Full Response: ${responseText}`);
            let displayErrorMessage = genericApiError;
            if (responseText && (responseText.trim().startsWith('<') || responseText.includes("<?xml"))) {
                displayErrorMessage += " (Received non-JSON/text response from Caspit). Check server logs for Caspit's full response.";
            } else if (responseText) {
                 displayErrorMessage += ` (Caspit response snippet: ${responseText.substring(0, 70)}${responseText.length > 70 ? '...' : ''}). Check server logs for full response.`;
            }
            throw new Error(displayErrorMessage);
        }

        let data;
        let accessToken: string | null = null;

        if (responseText.trim().startsWith('{')) {
             try {
                data = JSON.parse(responseText);
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
             } catch (jsonError) {
                 console.warn('[Caspit Action - getToken] Failed to parse as JSON. Will attempt to treat as plain text token. JSON Error:', (jsonError as Error).message);
             }
        }

        if (!accessToken) {
            if (typeof responseText === 'string' && responseText.length >= 20 && /^[a-zA-Z0-9.-_]+$/.test(responseText.replace(/^"+|"+$/g, ''))) {
                accessToken = responseText.trim().replace(/^"+|"+$/g, '');
                console.log('[Caspit Action - getToken] Interpreted response as plain text token.');
            } else {
                console.warn('[Caspit Action - getToken] Response is not valid JSON and does not look like a plain text token. Raw response logged above.');
                throw new Error('Caspit API returned an unparsable response or not a token. Check server logs.');
            }
        }

        if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
            console.error('[Caspit Action - getToken] Failed to extract token from response. Raw Response Text:', responseText);
            let detail = "AccessToken missing or empty in the response.";
            if (responseText.trim().startsWith("<")) {
                detail = "Received unexpected XML/HTML from Caspit instead of token.";
            } else if (responseText.length > 200) {
                detail = "Unexpected and lengthy response format from Caspit.";
            } else if (responseText.trim() !== "" && !accessToken) {
                console.warn("[Caspit Action - getToken] Potentially problematic responseText (not included in client error):", responseText);
                detail = "Unrecognized response format from Caspit.";
            }
            throw new Error(`Caspit API: Invalid token response. ${detail} Check server logs.`);
        }

        accessToken = accessToken.replace(/^"+|"+$/g, '');

        console.log('[Caspit Action - getToken] Successfully obtained token:', accessToken);
        return accessToken;

    } catch (error: any) {
        console.error('[Caspit Action - getToken] Error processing Caspit token request:', error.message);
        const specificMessage = error.message || 'Unknown error during token request.';
        if (specificMessage.toLowerCase().includes('fetch failed') || specificMessage.toLowerCase().includes('networkerror')) {
            throw new Error(`Network error while trying to reach Caspit API. Please check your internet connection and Caspit API status. Server logs may have more details.`);
        }
        throw new Error(`Caspit token request failed. Please check server logs for detailed error information.`);
    }
}


// --- Server Action to Test Connection ---
export async function testCaspitConnectionAction(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
        await getCaspitToken(config);
        return { success: true, message: 'Connection successful!' };
    } catch (error: any) {
        console.error("[Caspit Action - testConnection] Test failed:", error);
        return { success: false, message: "Connection test failed. Please check server console logs for details." };
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
        return { success: false, message: `Product sync failed: Could not get token. Check server logs.` };
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
                    throw new Error(`Failed to fetch products: Invalid token. Check server logs for token used and full response.`);
                 }
                throw new Error(`Failed to fetch products. Status: ${response.status}. Check server logs for full response.`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error(`[Caspit Action - syncProducts] Failed to parse JSON for page ${currentPage}. Response: ${responseText}`);
                throw new Error('Caspit API: Invalid JSON response from product API. Check server logs.');
            }

            if (!data || typeof data !== 'object' || !Array.isArray(data.Results)) {
                console.error(`[Caspit Action - syncProducts] Invalid product data structure received from Caspit API. Expected object with 'Results' array. Raw response: ${responseText}`);
                throw new Error(`Caspit API: Invalid product data structure. Check server logs.`);
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
        return { success: false, message: `Product sync failed: ${error.message || 'Unknown error. Check server logs.'}` };
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
        return { success: false, message: `Sales sync failed: Could not get token. Check server logs.` };
    }

    console.log("[Caspit Action - syncSales] Placeholder for sales sync...");
     try {
        // TODO: Implement actual sales sync logic with Caspit API (e.g., GET api/v1/Documents), using the token.
        // Remember to request 'Accept: application/json' header.
        // Map sales data to a meaningful structure for InvoTrack (e.g., affect inventory or create sales records).
        // Example: Fetch documents of type 'Invoice' (trxTypeId for Invoices)
        // const salesUrl = `${CASPIT_API_BASE_URL}/Documents?token=${token}&trxTypeId=YOUR_INVOICE_TRX_TYPE_ID&page=1`;
        // const salesResponse = await fetch(salesUrl, { headers: { 'Accept': 'application/json' } });
        // ... process salesResponse ...
        return { success: true, message: "Sales sync placeholder completed. Actual implementation pending." };
    } catch (error: any) {
        console.error("[Caspit Action - syncSales] Error during sales sync:", error);
         if (error instanceof Error && error.message.includes('401')) {
             return { success: false, message: `Sales sync failed: Invalid token. Check server logs.` };
         }
        return { success: false, message: `Sales sync failed: ${error.message || 'Unknown error. Check server logs.'}` };
    }
}
