/**
 * @fileOverview Implementation for the Hashavshevet POS/ERP system adapter.
 * Contains all business logic for interacting with Hashavshevet API.
 */

import type {
  IPosSystemAdapter,
  PosConnectionConfig,
  SyncResult,
  Product,
  Supplier,
  PosDocument,
  OperationResult,
  PosConfigField,
} from './pos-adapter.interface';

// TODO: Replace with actual Hashavshevet API details
const HASHAVSHEVET_API_BASE_URL = 'https://api.example-hashavshevet.com/v1';

/**
 * Hashavshevet adapter implementation
 */
class HashavshevetAdapter implements IPosSystemAdapter {
  readonly systemId = 'hashavshevet';
  readonly systemName = 'Hashavshevet (חשבשבת)';

  /**
   * Get configuration schema for Hashavshevet
   */
  getConfigSchema(): PosConfigField[] {
    return [
      {
        key: "apiKey",
        labelKey: "pos_config_hash_apikey",
        type: "password",
        tooltipKey: "pos_config_hash_apikey_tooltip",
        required: true,
      },
      // Add more fields as needed based on Hashavshevet requirements
    ];
  }

  /**
   * Get available document types
   */
  getAvailableDocumentTypes(): string[] {
    return ["invoice", "deliveryNote", "order"];
  }

  /**
   * Validate configuration
   */
  async validateConfig(config: PosConnectionConfig): Promise<{
    valid: boolean;
    errors?: { field: string; message: string }[];
  }> {
    const errors: { field: string; message: string }[] = [];

    if (!config.apiKey) {
      errors.push({ field: "apiKey", message: "API Key is required" });
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get Hashavshevet auth headers
   * @private
   */
  private async getHashavshevetAuthHeaders(config: PosConnectionConfig): Promise<Record<string, string>> {
    const { apiKey } = config;
    if (!apiKey) {
      throw new Error('Missing Hashavshevet API Key in configuration.');
    }
    console.log('[HashavshevetAdapter] Using API Key');
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /**
   * Map Hashavshevet product to application product
   * @private
   */
  private mapHashavshevetProductToApp(hashavshevetProduct: any): Product | null {
    const productId = hashavshevetProduct.InternalID || hashavshevetProduct.ItemKey;
    const catalogNumber = hashavshevetProduct.ItemCode || hashavshevetProduct.CatalogNum || "";
    const description = hashavshevetProduct.ItemName || hashavshevetProduct.Description || "";
    const unitPrice = hashavshevetProduct.PurchasePrice || hashavshevetProduct.CostPrice || 0;
    const salePrice = hashavshevetProduct.SalePrice || hashavshevetProduct.ListPrice || undefined;
    const quantityInStock = hashavshevetProduct.StockQuantity ?? hashavshevetProduct.QuantityOnHand ?? 0;

    if (!productId && !catalogNumber && !description) {
      console.warn('[HashavshevetAdapter] Skipping product due to missing identifiers:', hashavshevetProduct);
      return null;
    }

    const product: Product = {
      catalogNumber: catalogNumber || "",
      description: description || "No Description",
      quantity: quantityInStock,
      unitPrice: unitPrice,
      salePrice: salePrice,
      lineTotal: quantityInStock * unitPrice,
      externalIds: {
        hashavshevet: productId,
      },
    };

    return product;
  }

  // --- Connection Test ---
  async testConnection(config: PosConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
      const headers = await this.getHashavshevetAuthHeaders(config);
      const testUrl = `${HASHAVSHEVET_API_BASE_URL}/test-endpoint`;
      console.log('[HashavshevetAdapter] Testing connection to:', testUrl);

      // This is a placeholder - replace with actual API call
      const response = await fetch(testUrl, { method: 'GET', headers });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hashavshevet API Error (${response.status}): ${errorText || response.statusText}`);
      }

      console.log('[HashavshevetAdapter] Test connection successful.');
      return { success: true, message: 'Connection successful!' };
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Test failed:", error);
      return { success: false, message: `Connection test failed: ${error.message}` };
    }
  }

  // --- Product Operations ---

  async createOrUpdateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult<{ externalId: string }>> {
    try {
      const headers = await this.getHashavshevetAuthHeaders(config);
      const hashavshevetProductId = product.externalIds?.hashavshevet;
      const isUpdate = !!hashavshevetProductId;

      // TODO: Implement actual Hashavshevet API payload structure
      const payload = {
        ItemCode: product.catalogNumber,
        ItemName: product.description,
        PurchasePrice: product.unitPrice,
        SalePrice: product.salePrice,
        StockQuantity: product.quantity,
      };

      const url = isUpdate
        ? `${HASHAVSHEVET_API_BASE_URL}/items/${hashavshevetProductId}`
        : `${HASHAVSHEVET_API_BASE_URL}/items`;
      const method = isUpdate ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hashavshevet API error: ${errorText}`);
      }

      const responseData = await response.json();
      const externalId = responseData.InternalID || responseData.ItemKey || hashavshevetProductId;

      return {
        success: true,
        message: `Product ${isUpdate ? "updated" : "created"} successfully`,
        data: { externalId },
      };
    } catch (error: any) {
      console.error('[HashavshevetAdapter] Error in createOrUpdateProduct:', error);
      return {
        success: false,
        message: `Failed to create/update product: ${error.message}`,
      };
    }
  }

  async updateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult> {
    if (!product.externalIds?.hashavshevet) {
      return {
        success: false,
        message: "Product does not have a Hashavshevet ID for update",
      };
    }
    return this.createOrUpdateProduct(config, product);
  }

  async deactivateProduct(
    config: PosConnectionConfig,
    product: Product
  ): Promise<OperationResult> {
    // TODO: Implement based on Hashavshevet API capabilities
    return {
      success: false,
      message: "Product deactivation not yet implemented for Hashavshevet",
    };
  }

  async syncProducts(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting product sync...`);
    try {
      const headers = await this.getHashavshevetAuthHeaders(config);
      const allProducts: Product[] = [];
      let currentPage = 1;
      const pageSize = 50;

      // TODO: Implement actual pagination logic based on Hashavshevet API
      const url = `${HASHAVSHEVET_API_BASE_URL}/items?page=${currentPage}&pageSize=${pageSize}`;
      console.log(`[HashavshevetAdapter] Fetching products from: ${url}`);

      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Failed to fetch products: ${responseText}`);
      }

      const data = await response.json();
      const productsData = Array.isArray(data) ? data : data.items || [];

      const mappedProducts = productsData
        .map((p: any) => this.mapHashavshevetProductToApp(p))
        .filter((p: Product | null): p is Product => p !== null);

      allProducts.push(...mappedProducts);

      return {
        success: true,
        message: `Successfully synced ${allProducts.length} products`,
        itemsSynced: allProducts.length,
        products: allProducts,
      };
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error syncing products:", error);
      return {
        success: false,
        message: `Product sync failed: ${error.message}`,
      };
    }
  }

  // --- Supplier Operations ---

  async createOrUpdateSupplier(
    config: PosConnectionConfig,
    supplier: Supplier
  ): Promise<OperationResult<{ externalId: string }>> {
    // TODO: Implement based on Hashavshevet API
    return {
      success: false,
      message: "Supplier operations not yet implemented for Hashavshevet",
    };
  }

  async syncSuppliers(config: PosConnectionConfig): Promise<SyncResult> {
    // TODO: Implement based on Hashavshevet API
    return {
      success: false,
      message: "Supplier sync not yet implemented for Hashavshevet",
    };
  }

  // --- Document Operations ---

  async createDocument(
    config: PosConnectionConfig,
    document: PosDocument,
    externalSupplierId: string
  ): Promise<OperationResult<{ externalId: string }>> {
    // TODO: Implement based on Hashavshevet API
    return {
      success: false,
      message: "Document operations not yet implemented for Hashavshevet",
    };
  }

  async syncDocuments(config: PosConnectionConfig): Promise<SyncResult> {
    // TODO: Implement based on Hashavshevet API
    return {
      success: false,
      message: "Document sync not yet implemented for Hashavshevet",
    };
  }

  // --- Sales Operations ---

  async syncSales(config: PosConnectionConfig): Promise<SyncResult> {
    console.log(`[HashavshevetAdapter] Starting sales sync...`);
    try {
      const headers = await this.getHashavshevetAuthHeaders(config);
      // TODO: Implement actual sales sync based on Hashavshevet API
      const url = `${HASHAVSHEVET_API_BASE_URL}/sales`;
      
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Failed to fetch sales: ${responseText}`);
      }

      const salesData = await response.json();
      console.log(`[HashavshevetAdapter] Received ${salesData.length} sales records`);

      return {
        success: true,
        message: `Successfully synced ${salesData.length} sales`,
        itemsSynced: salesData.length,
        data: salesData,
      };
    } catch (error: any) {
      console.error("[HashavshevetAdapter] Error syncing sales:", error);
      return {
        success: false,
        message: `Sales sync failed: ${error.message}`,
      };
    }
  }
}

export const hashavshevetAdapter = new HashavshevetAdapter();
