import type { Timestamp, FieldValue } from "firebase/firestore";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";

// Note: For client-facing types, date fields that are Timestamps in Firestore
// should be represented as `string` (e.g., ISO string) because server actions
// will serialize them before sending to the client. The `FieldValue` type
// should only be used in server-side update/create operations, not in shared types.

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
  settings?: UserSettings;
}

export interface Product {
  id: string; // Firestore document ID
  userId: string;
  name: string;
  barcode?: string | null;
  price: number;
  cost?: number | null; // Added
  quantity: number;
  stock?: number; // Added
  supplier?: string | null; // Added
  category?: string | null; // Added
  status: "active" | "inactive" | "archived";
  imageUrl?: string | null;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  lastPurchasedAt?: Timestamp | FieldValue; // Added
  caspitId?: string | null; // Changed to string to be more flexible
}

export interface InvoiceHistoryItem {
  id: string; // Firestore document ID
  userId: string;
  originalFileName: string;
  supplier: string;
  supplierName?: string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null | Date | Timestamp;
  totalAmount?: number | null;
  itemCount: number;
  paymentMethod?: string | null;
  paymentDueDate?: string | null | Timestamp;
  paymentStatus: "paid" | "unpaid" | "pending" | "overdue";
  paymentDate?: string | null | Timestamp;
  status: "pending" | "processing" | "completed" | "error" | "archived";
  documentType: "invoice" | "deliveryNote" | "paymentReceipt";
  isArchived: boolean;
  uploadedAt: string | Date | Timestamp;
  uploadTime?: string | Date | Timestamp;
  updatedAt?: string | Timestamp;
  products: (string | Product)[];
  paymentReceiptImageUri?: string | null;
  originalImageUri?: string | null;
  compressedImageUri?: string | null;
  originalImagePreviewUri?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  generatedFileName?: string;
  errorMessage?: string;
  _displayContext?: "full_details" | "image_only";
  rawScanResultJson?: string | null;
  caspitPurchaseDocId?: string | null;
  syncError?: string | null;
}

export interface SupplierSummary {
  id: string;
  userId: string;
  name: string;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
  createdAt?: Timestamp | FieldValue; // made optional
  updatedAt?: Timestamp | FieldValue;
  caspitAccountId?: string | null; // Renamed from caspitId
  totalAmountBilled?: number;
  outstandingBalance?: number;
}

export interface AccountantSettings {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface KpiPreferences {
  visibleKpiIds: string[];
  kpiOrder: string[];
}

export interface QuickActionPreferences {
  visibleQuickActionIds: string[];
  quickActionOrder: string[];
}
export interface UserSettings {
  // No ID needed here as it's a nested object in the User document.
  posConnection?: PosConnectionConfig; // Added
  reminderDaysBefore?: number | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences: KpiPreferences;
  quickActionPreferences: QuickActionPreferences;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Date | Timestamp; // Serialized on client
  category: string;
  categoryId?: string | null;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
}

export interface ExpenseCategory {
  id: string;
  userId: string;
  name: string;
  isFixed?: boolean;
  defaultAmount?: number | null;
  createdAt: Timestamp | FieldValue;
}

export interface ProductPriceDiscrepancy {
  productId: string;
  name: string;
  barcode?: string | null; // Changed to optional
  oldPrice?: number | null; // Changed to optional
  newPrice?: number | null;
  oldCost?: number | null; // Added
  newCost?: number | null; // Added
}

export interface PriceCheckResult {
  hasDiscrepancies: boolean; // Added
  discrepancies: ProductPriceDiscrepancy[];
}
