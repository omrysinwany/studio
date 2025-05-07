import type { Product, InvoiceHistoryItem } from '@/services/backend';

// Function to calculate the total inventory value
export const calculateInventoryValue = (inventory: Product[]): number => {
    return inventory.reduce((acc, product) => acc + (product.lineTotal || 0), 0);
};

// Function to calculate the total number of items
export const calculateTotalItems = (inventory: Product[]): number => {
    return inventory.reduce((acc, product) => acc + (product.quantity || 0), 0);
};

// Function to identify low stock items (quantity <= minStockLevel or default 10 if not set)
export const getLowStockItems = (inventory: Product[]): Product[] => {
    return inventory.filter(product => product.quantity !== undefined && product.quantity <= (product.minStockLevel ?? 10));
};

// Function to calculate the total potential gross profit from current inventory
export const calculateTotalPotentialGrossProfit = (inventory: Product[]): number => {
    return inventory.reduce((acc, product) => {
        if (product.salePrice !== undefined && product.unitPrice !== undefined && product.quantity !== undefined && product.salePrice > product.unitPrice) {
            const profitPerUnit = product.salePrice - product.unitPrice;
            acc += profitPerUnit * product.quantity;
        }
        return acc;
    }, 0);
};


// Mock function (replace with actual logic when available) to calculate Gross Profit Margin
export const calculateGrossProfitMargin = (totalRevenue: number, costOfGoodsSold: number): number => {
    if (totalRevenue === 0) return 0; // Prevent division by zero if no revenue
    return ((totalRevenue - costOfGoodsSold) / totalRevenue) * 100;
};

// Mock function (replace with actual logic when available) to calculate Inventory Turnover Rate
export const calculateInventoryTurnoverRate = (costOfGoodsSold: number, averageInventoryValue: number): number => {
    if (averageInventoryValue === 0) return 0; // Prevent division by zero
    return costOfGoodsSold / averageInventoryValue;
};

// Mock function (replace with actual logic when available) to calculate Average Order Value
export const calculateAverageOrderValue = (invoices: InvoiceHistoryItem[]): number => {
     if (invoices.length === 0) return 0; // Prevent division by zero
    const total = invoices.reduce((acc, invoice) => acc + (invoice.totalAmount || 0), 0);
    return total / invoices.length;
};

