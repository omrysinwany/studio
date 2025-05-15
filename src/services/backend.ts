
// src/services/backend.ts
'use client';

import { db, auth as firebaseAuth } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  Timestamp,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  limit,
  orderBy,
  addDoc,
  FieldValue,
  deleteField,
  runTransaction
} from "firebase/firestore";
import { parseISO, isValid } from 'date-fns';
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

// Firestore Collection Names
export const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts";
export const DOCUMENTS_COLLECTION = "documents";
export const SUPPLIERS_COLLECTION = "suppliers";
export const OTHER_EXPENSES_COLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";
export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates";
export const USER_SETTINGS_COLLECTION = "userSettings";


export interface User {
  id: string;
  username?: string;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string;
  userId?: string;
  catalogNumber: string;
  description: string;
  shortName?: string;
  barcode?: string | null;
  quantity: number;
  unitPrice: number; // Represents cost price
  salePrice?: number | null;
  lineTotal: number; // Typically quantity * unitPrice (cost price) from the document
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  _originalId?: string; // Internal use, e.g., for matching during edits
  lastUpdated?: Timestamp | FieldValue;
}

export interface InvoiceHistoryItem {
  id: string;
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp;
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | null;
  totalAmount?: number | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | null;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string | null;
  originalImagePreviewUri?: string | null;
  compressedImageForFinalRecordUri?: string | null;
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null;
}


export interface DocumentLineItem {
  documentId?: string;
  userId?: string;
  productId?: string;
  productName: string;
  catalogNumber?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  shortProductName?: string;
}


export interface SupplierSummary {
  id: string;
  userId: string;
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
  lastActivityDate?: string | Timestamp | null;
  createdAt: Timestamp | FieldValue;
}

export interface AccountantSettings {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface UserSettings {
  userId: string;
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: { visibleKpiIds: string[], kpiOrder: string[] } | null;
  quickActionPreferences?: { visibleQuickActionIds: string[], quickActionOrder: string[] } | null;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  category: string;
  _internalCategoryKey?: string | null;
}

export interface ExpenseCategory {
  id: string;
  userId: string;
  name: string;
  internalKey: string;
  isFixed?: boolean;
  defaultAmount?: number;
  createdAt: Timestamp | FieldValue;
}


export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  categoryKey: string;
  description: string;
  amount: number;
  createdAt: Timestamp | FieldValue;
}

// --- Storage Keys for localStorage (mostly for UI preferences now) ---
export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';
// The following are effectively deprecated for data storage, used only for temp scan data OR specific UI pages that haven't been fully migrated
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory'; // Still used by some old logic, should be phased out
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices'; // Still used by some old logic, should be phased out
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers'; // Still used by some old logic
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings'; // Still used by some old logic
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings'; // Used for storing user-specific UI settings
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings'; // Should be part of UserSettings in Firestore
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget'; // Should be part of UserSettings in Firestore
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses'; // Still used by some old logic
export const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories'; // Still used by some old logic

// --- Storage Keys for temporary data during scan process (localStorage) ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// --- Storage Limits (localStorage) ---
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.3 * 1024 * 1024; // 0.3MB
export const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.15 * 1024 * 1024; // 0.15MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.4 * 1024 * 1024; // 0.4MB for scan results JSON
export const MAX_INVOICE_HISTORY_ITEMS = 10;


export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}


export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

export const getStoredData = <T extends {id?: string; name?: string}>(keyBase: string, userId?: string, defaultDataIfNoUserOrError: T[] = []): T[] => {
  if (typeof window === 'undefined') return defaultDataIfNoUserOrError;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsedData = JSON.parse(stored) as T[];
      return parsedData.map((item, index) => ({
          ...item,
          id: item.id || (item.name ? `${keyBase}-item-${item.name.replace(/\s+/g, '_')}-${index}` : `${keyBase}-item-${Date.now()}-${index}-${Math.random().toString(36).substring(2,7)}`)
      }));
    }
    return defaultDataIfNoUserOrError;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return defaultDataIfNoUserOrError;
  }
};

const saveStoredData = (keyBase: string, data: any, userId?: string): boolean => {
  if (typeof window === 'undefined') return false;
  if (!userId && ![KPI_PREFERENCES_STORAGE_KEY_BASE, QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE].includes(keyBase)) {
    console.warn(`[saveStoredData] Attempted to save data for base "${keyBase}" without a userId. Operation aborted.`);
    return false;
  }
  const storageKey = getStorageKey(keyBase, userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch (error: any) {
    console.error(`Error writing to localStorage for key ${storageKey}:`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`Quota exceeded for key ${storageKey}. Attempting to clear old temporary scan data and retry...`);
      try {
        clearOldTemporaryScanData(true, userId); 
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`Successfully saved to localStorage after cleanup for key ${storageKey}`);
        return true;
      } catch (retryError) {
        console.error(`Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        const quotaError = new Error(`Failed to save data to localStorage after cleanup due to storage quota: ${(retryError as Error).message}`);
        (quotaError as any).isQuotaError = true;
        throw quotaError;
      }
    } else {
        const genericError = new Error(`Failed to save data to localStorage: ${(error as Error).message}`);
        (genericError as any).isQuotaError = false;
        throw genericError;
    }
  }
};

// Helper to sanitize data for Firestore (replace undefined with null)
export function sanitizeForFirestore<T extends object>(data: T): T {
  const sanitizedData = { ...data };
  for (const key in sanitizedData) {
    if (sanitizedData[key] === undefined) {
      (sanitizedData as any)[key] = null;
    }
  }
  return sanitizedData;
}


// --- User Management (Firestore) ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userData.id) throw new Error("User ID is missing for saveUserToFirestore.");
  
  const userRef = doc(db, USERS_COLLECTION, userData.id);
  const dataToSave: Partial<User> = sanitizeForFirestore({ ...userData });
  
  try {
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    dataToSave.lastLoginAt = serverTimestamp();
    await setDoc(userRef, dataToSave, { merge: true });
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw error;
  }
}

export async function getUserFromFirestore(userId: string): Promise<User | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getUserFromFirestore.");
    return null;
  }
  if (!userId) {
    console.warn("getUserFromFirestore called without userId");
    return null;
  }
  
  const userRef = doc(db, USERS_COLLECTION, userId);
  try {
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as User;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Inventory Product Management (Firestore) ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductsService.");
    return [];
  }
  if (!userId) {
    console.warn("getProductsService called without userId");
    return [];
  }
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), orderBy("shortName"));
  try {
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Product));
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductByIdService.");
    return null;
  }
  if (!userId) {
    console.warn("getProductByIdService called without userId");
    return null;
  }
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      return { id: docSnap.id, ...docSnap.data() } as Product;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Product>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateProductService.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  const dataToUpdate: Partial<Product> & { userId: string, lastUpdated: FieldValue } = sanitizeForFirestore({
    ...updatedData,
    userId, 
    lastUpdated: serverTimestamp()
  });

  try {
    // Ensure the product belongs to the user before updating
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for update.");
    }
    await updateDoc(productRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteProductService.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists() || productDoc.data().userId !== userId) {
      throw new Error("Permission denied or product not found for deletion.");
    }
    await deleteDoc(productRef);
  } catch (error) {
    console.error(`Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for clearInventoryService.");
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
  try {
    const snapshot = await getDocs(productsQuery);
    if (snapshot.empty) return;
    const batch = writeBatch(db);
    snapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
    await batch.commit();
  } catch (error) {
    console.error("Error clearing inventory from Firestore:", error);
    throw error;
  }
}

// --- Document (Invoice/Delivery Note) Management (Firestore) ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getInvoicesService.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId");
    return [];
  }
  
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
  try {
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const convertTimestampToString = (field: any) => field instanceof Timestamp ? field.toDate().toISOString() : (typeof field === 'string' ? field : null);
        return {
            id: docSnap.id, ...data,
            uploadTime: convertTimestampToString(data.uploadTime),
            invoiceDate: convertTimestampToString(data.invoiceDate),
            paymentDueDate: convertTimestampToString(data.paymentDueDate),
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoiceService.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const dataToUpdate: any = sanitizeForFirestore({ ...updatedData, userId }); // Ensure userId is part of the update

  // Convert date strings to Timestamps if they are valid ISO strings
  if (dataToUpdate.invoiceDate && typeof dataToUpdate.invoiceDate === 'string' && isValid(parseISO(dataToUpdate.invoiceDate))) {
    dataToUpdate.invoiceDate = Timestamp.fromDate(parseISO(dataToUpdate.invoiceDate));
  } else if (dataToUpdate.invoiceDate && !(dataToUpdate.invoiceDate instanceof Timestamp)){
    dataToUpdate.invoiceDate = null;
  }
  
  if (dataToUpdate.paymentDueDate && typeof dataToUpdate.paymentDueDate === 'string' && isValid(parseISO(dataToUpdate.paymentDueDate))) {
    dataToUpdate.paymentDueDate = Timestamp.fromDate(parseISO(dataToUpdate.paymentDueDate));
  } else if (dataToUpdate.paymentDueDate && !(dataToUpdate.paymentDueDate instanceof Timestamp)){
    dataToUpdate.paymentDueDate = null;
  }

  try {
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateInvoicePaymentStatusService.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = sanitizeForFirestore({ paymentStatus, userId, paymentReceiptImageUri: paymentReceiptImageUri === undefined ? null : paymentReceiptImageUri });
 
  if (paymentStatus !== 'paid') {
    updateData.paymentReceiptImageUri = null;
  }
  try {
     const docSnap = await getDoc(docRef);
     if(!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Permission denied or document not found for payment status update.");
     }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteInvoiceService.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for deletion.");
    }
    await deleteDoc(docRef);
  } catch (error) {
    console.error(`Error deleting document ${invoiceId} from Firestore:`, error);
    throw error;
  }
}


export async function checkProductPricesBeforeSaveService(
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> {
  if (!db) {
    console.error("Firestore (db) is not initialized in checkProductPricesBeforeSaveService.");
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }
  if (!userId) {
    console.warn("checkProductPricesBeforeSaveService called without userId");
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = typeof product.unitPrice === 'number' ? product.unitPrice : parseFloat(String(product.unitPrice));
    if (isNaN(currentProductUnitPrice)) {
      productsToSaveDirectly.push(product); // If no valid price, save as is (will be handled as new)
      continue;
    }
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

    // If product has no ID or a temporary ID, it's considered new or not yet in DB
    if (!product.id || product.id.startsWith('prod-temp-') || product.id.includes('-new')) {
      productsToSaveDirectly.push(productWithNumericPrice);
      continue;
    }

    try {
      const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
      const existingProductSnap = await getDoc(existingProductRef);

      if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
        const existingProductData = existingProductSnap.data() as Product;
        const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice));
        // Only flag discrepancy if new price is valid (positive) and different
        if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice); // No discrepancy or new price is invalid/zero
        }
      } else {
        // Product ID exists but doesn't belong to user or doesn't exist -> treat as new for this user context
        productsToSaveDirectly.push(productWithNumericPrice);
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice); // On error, assume no discrepancy to avoid blocking
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


// --- Save Scanned/Edited Document and Update Inventory (Firestore) ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string, // ID of the PENDING document in Firestore
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string | Date | Timestamp,
    invoiceDate?: string | Date | Timestamp,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string | null,
    compressedImageForFinalRecordUriToSave?: string | null
): Promise<{
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {
    if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
    if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
    console.log(`[finalizeSaveProductsService] Starting. User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products: ${productsToFinalizeSave.length}`);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batch = writeBatch(db);

    const shouldUpdateInventory = documentType === 'deliveryNote';

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        console.log("[finalizeSaveProductsService] Processing products for inventory update...");
        for (const productFromDoc of productsToFinalizeSave) {
            const quantityFromDoc = parseFloat(String(productFromDoc.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productFromDoc.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productFromDoc.lineTotal)) || 0;

            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductRef;
            let existingProductData: Product | undefined = undefined;

            // Try to find by ID first if it's a "real" ID
            if (productFromDoc.id && !productFromDoc.id.startsWith('prod-temp-') && !productFromDoc.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productFromDoc.id);
                const snap = await getDoc(existingProductRef);
                if (snap.exists() && snap.data().userId === userId) {
                    existingProductData = { id: snap.id, ...snap.data() } as Product;
                }
            }
            // If not found by ID, try by catalog number
            if (!existingProductData && productFromDoc.catalogNumber && productFromDoc.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromDoc.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductRef = catSnap.docs[0].ref;
                    existingProductData = { id: catSnap.docs[0].id, ...catSnap.docs[0].data() } as Product;
                }
            }
            // If still not found, try by barcode
            if (!existingProductData && productFromDoc.barcode && productFromDoc.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromDoc.barcode.trim()), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductRef = barSnap.docs[0].ref;
                    existingProductData = { id: barSnap.docs[0].id, ...barSnap.docs[0].data() } as Product;
                }
            }

            if (existingProductRef && existingProductData) {
                console.log(`[finalizeSaveProductsService] Updating existing product: ${existingProductData.id} (${existingProductData.shortName})`);
                const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
                const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
                // Use new unit price from delivery note if it's positive, otherwise keep existing
                const newCostPrice = unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0);

                const updatePayload: Partial<Product> = sanitizeForFirestore({
                    quantity: updatedQuantity,
                    unitPrice: newCostPrice, // This updates the cost price based on the delivery note
                    lineTotal: parseFloat(((updatedQuantity || 0) * (newCostPrice || 0)).toFixed(2)), // Recalculate lineTotal based on new quantity and potentially new cost
                    lastUpdated: serverTimestamp(),
                    // Only update these if explicitly provided in productFromDoc (e.g., from BarcodePromptDialog)
                    ...(productFromDoc.description && { description: productFromDoc.description }),
                    ...(productFromDoc.shortName && { shortName: productFromDoc.shortName }),
                    ...(productFromDoc.barcode && { barcode: productFromDoc.barcode }), // Update barcode if provided
                    ...(productFromDoc.salePrice !== undefined && { salePrice: productFromDoc.salePrice }), // Update salePrice if provided
                });
                batch.update(existingProductRef, updatePayload);
                savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload } as Product);
            } else {
                if (!productFromDoc.catalogNumber && !productFromDoc.description && !productFromDoc.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping new product as it lacks key identifiers:", productFromDoc);
                    continue;
                }
                console.log(`[finalizeSaveProductsService] Creating new product: ${productFromDoc.shortName}`);
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                const newProductData: Product = sanitizeForFirestore({
                    id: newProductRef.id,
                    userId,
                    catalogNumber: productFromDoc.catalogNumber || 'N/A',
                    description: productFromDoc.description || 'No Description',
                    shortName: productFromDoc.shortName || (productFromDoc.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    barcode: (productFromDoc.barcode && productFromDoc.barcode.trim() !== '') ? productFromDoc.barcode.trim() : null,
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
                    salePrice: productFromDoc.salePrice !== undefined && !isNaN(Number(productFromDoc.salePrice)) ? Number(productFromDoc.salePrice) : null,
                    lineTotal: parseFloat((quantityFromDoc * (unitPriceFromDoc > 0 ? unitPriceFromDoc : 0)).toFixed(2)),
                    minStockLevel: productFromDoc.minStockLevel !== undefined && !isNaN(Number(productFromDoc.minStockLevel)) ? Number(productFromDoc.minStockLevel) : null,
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined && !isNaN(Number(productFromDoc.maxStockLevel)) ? Number(productFromDoc.maxStockLevel) : null,
                    imageUrl: productFromDoc.imageUrl || null,
                    lastUpdated: serverTimestamp(),
                }) as Product;
                batch.set(newProductRef, newProductData);
                savedProductsWithFinalIds.push(newProductData);
            }
        }
    } else if (documentType === 'invoice' && productsToFinalizeSave.length > 0) { // For tax invoices, just sum up totals if available
        productsToFinalizeSave.forEach(productFromDoc => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productFromDoc.lineTotal)) || 0);
        });
    }

    // Prepare document data
    const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount) && extractedTotalAmount > 0)
                                    ? extractedTotalAmount
                                    : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2));

    let finalGeneratedFileName = originalFileNameFromUpload;
    if (finalSupplierName && finalSupplierName.trim() !== '') {
        finalGeneratedFileName = finalSupplierName.trim();
        if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
            finalGeneratedFileName += `_${extractedInvoiceNumber.trim()}`;
        }
    } else if (extractedInvoiceNumber && extractedInvoiceNumber.trim() !== '') {
        finalGeneratedFileName = `Invoice_${extractedInvoiceNumber.trim()}`;
    }
    finalGeneratedFileName = finalGeneratedFileName.replace(/[/\\?%*:|"<>]/g, '-').substring(0,100);

    const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp } = sanitizeForFirestore({
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: Timestamp.now(), // Always use current server time for final save
        status: 'completed', // Mark as completed
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: !isNaN(finalInvoiceTotalAmount) ? finalInvoiceTotalAmount : null,
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        paymentStatus: 'unpaid', // Default for new final documents
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' && isValid(parseISO(paymentDueDate)) ? Timestamp.fromDate(parseISO(paymentDueDate)) : (paymentDueDate instanceof Timestamp ? paymentDueDate : null)),
        invoiceDate: invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' && isValid(parseISO(invoiceDate)) ? Timestamp.fromDate(parseISO(invoiceDate)) : (invoiceDate instanceof Timestamp ? invoiceDate : null)),
        paymentMethod: paymentMethod || null,
        errorMessage: null, // Clear any previous error message
        paymentReceiptImageUri: null,
        linkedDeliveryNoteId: null,
    }) as Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp };
    
    let docRef;
    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        console.log(`[finalizeSaveProductsService] Updating/finalizing PENDING document ID: ${tempInvoiceId}`);
        batch.set(docRef, documentDataForFirestore); // Use set to overwrite the pending document completely with final data
    } else if (tempInvoiceId) { 
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        console.log(`[finalizeSaveProductsService] Updating EXISTING document ID (non-pending): ${tempInvoiceId}`);
        batch.update(docRef, documentDataForFirestore);
    } else { 
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] Creating NEW document with auto-ID`);
        batch.set(docRef, documentDataForFirestore);
    }
    
    const finalUploadTime = documentDataForFirestore.uploadTime.toDate().toISOString();
    const finalInvoiceDate = documentDataForFirestore.invoiceDate instanceof Timestamp ? documentDataForFirestore.invoiceDate.toDate().toISOString() : documentDataForFirestore.invoiceDate;
    const finalPaymentDueDate = documentDataForFirestore.paymentDueDate instanceof Timestamp ? documentDataForFirestore.paymentDueDate.toDate().toISOString() : documentDataForFirestore.paymentDueDate;

    const finalInvoiceRecord: InvoiceHistoryItem = { 
        ...documentDataForFirestore, 
        id: docRef.id, 
        uploadTime: finalUploadTime,
        invoiceDate: finalInvoiceDate as string | null, // Cast to string | null after conversion
        paymentDueDate: finalPaymentDueDate as string | null, // Cast to string | null after conversion
    };

    try {
      console.log("[finalizeSaveProductsService] Attempting to commit batch to Firestore...");
      await batch.commit();
      console.log("[finalizeSaveProductsService] Batch commit successful.");
      // Clear temporary data from localStorage ONLY after successful Firestore commit
      const uniqueScanIdToClear = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : null;
      if (uniqueScanIdToClear) {
        clearTemporaryScanData(uniqueScanIdToClear, userId);
      }
    } catch (error: any) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      // Don't throw an error that includes uniqueScanIdToClear here, as it's for localStorage
      throw new Error(`Failed to save to Firestore: ${error.message}`);
    }
    console.log("[finalizeSaveProductsService] Completed successfully. Final Invoice ID:", finalInvoiceRecord.id);
    return { finalInvoiceRecord, savedProductsWithFinalIds };
}


// --- Supplier Management (Firestore) ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getSupplierSummariesService.");
    return [];
  }
  if (!userId) {
    console.warn("getSupplierSummariesService called without userId");
    return [];
  }

  const suppliersQuery = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId));
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), where("status", "==", "completed"));

  try {
    const [suppliersSnapshot, documentsDataSnapshot] = await Promise.all([ // Renamed to avoid conflict
      getDocs(suppliersQuery),
      getDocs(documentsQuery)
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      supplierMap.set(data.name, { // Use name as key for easier lookup from documents
        id: docSnap.id, userId, name: data.name,
        phone: data.phone || null, email: data.email || null, paymentTerms: data.paymentTerms || null,
        invoiceCount: 0, totalSpent: 0,
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : (typeof data.lastActivityDate === 'string' ? data.lastActivityDate : null),
        createdAt: data.createdAt,
      });
    });

    documentsDataSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem;
      if (docData.supplierName && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
            supplierEntry.invoiceCount += 1;
            supplierEntry.totalSpent += (docData.totalAmount || 0);

            let docUploadTime: Date | null = null;
            if (docData.uploadTime) {
                if (docData.uploadTime instanceof Timestamp) docUploadTime = docData.uploadTime.toDate();
                else if (typeof docData.uploadTime === 'string' && isValid(parseISO(docData.uploadTime))) docUploadTime = parseISO(docData.uploadTime);
            }

            if (docUploadTime) {
              const currentLastActivity = supplierEntry.lastActivityDate ? parseISO(supplierEntry.lastActivityDate as string) : null;
              if (!currentLastActivity || docUploadTime > currentLastActivity) {
                supplierEntry.lastActivityDate = docUploadTime.toISOString();
              }
            }
        }
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for createSupplierService.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error(`Supplier with name "${normalizedName}" already exists.`);

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  const newSupplierData = sanitizeForFirestore({
    id: newSupplierRef.id, // Pre-generate ID and store it in the document
    userId, name: normalizedName,
    phone: contactInfo.phone?.trim() || null, 
    email: contactInfo.email?.trim() || null, 
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0, totalSpent: 0, lastActivityDate: null, createdAt: serverTimestamp(),
  });
  await setDoc(newSupplierRef, newSupplierData);
  return { ...newSupplierData, createdAt: Timestamp.now() } as SupplierSummary; // Return with client-side timestamp for immediate use
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for deleteSupplierService.");
  
  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for deletion.`);
  }
  await deleteDoc(supplierRef);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string, isNewSupplier: boolean = false): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required for updateSupplierContactInfoService.");

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  
  if (!isNewSupplier) {
    const supplierDoc = await getDoc(supplierRef);
    if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
      throw new Error(`Supplier not found or permission denied for update.`);
    }
  }

  const updateData: any = { userId }; 
  let hasChanges = false;
  if (contactInfo.phone !== undefined) { updateData.phone = contactInfo.phone.trim() || null; hasChanges = true; }
  if (contactInfo.email !== undefined) { updateData.email = contactInfo.email.trim() || null; hasChanges = true; }
  if (contactInfo.paymentTerms !== undefined) { updateData.paymentTerms = contactInfo.paymentTerms.trim() || null; hasChanges = true; }
  
  if (isNewSupplier) {
      updateData.createdAt = serverTimestamp(); 
      hasChanges = true; 
  }

  if (hasChanges) {
      await setDoc(supplierRef, sanitizeForFirestore(updateData), { merge: true }); 
  }
}


// --- Settings Management (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required for saveUserSettingsService.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const settingsToSave: any = { ...settings, userId };

    if (settings.accountantSettings) {
        settingsToSave.accountantSettings = sanitizeForFirestore({
            name: settings.accountantSettings.name || null,
            email: settings.accountantSettings.email || null,
            phone: settings.accountantSettings.phone || null,
        });
    } else if (settings.hasOwnProperty('accountantSettings')) { 
        settingsToSave.accountantSettings = null;
    }

    if (settings.posConfig) {
        settingsToSave.posConfig = sanitizeForFirestore(settings.posConfig);
    } else if (settings.hasOwnProperty('posConfig')) {
        settingsToSave.posConfig = {}; // Default to empty object if explicitly set to null/undefined
    }
    
    await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave), { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        return { 
            userId, 
            ...data,
            accountantSettings: data.accountantSettings ? {
                name: data.accountantSettings.name || null,
                email: data.accountantSettings.email || null,
                phone: data.accountantSettings.phone || null,
            } : { name: null, email: null, phone: null },
            posConfig: data.posConfig || {},
        } as UserSettings;
    }
    return {
        userId,
        reminderDaysBefore: 3, 
        posSystemId: null,
        posConfig: {},
        accountantSettings: { name: null, email: null, phone: null },
        monthlyBudget: null,
        kpiPreferences: null,
        quickActionPreferences: null,
    };
}

// --- Other Expenses & Categories (Firestore) ---
export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
    if (!db || !userId) return [];
    const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId), orderBy("date", "desc"));
    const snapshot = await getDocs(expensesQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
            id: docSnap.id, ...data,
            date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date,
        } as OtherExpense;
    });
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'| 'createdAt'> & {id?: string}, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const dataToSave = sanitizeForFirestore({
    ...expenseData,
    userId,
    date: typeof expenseData.date === 'string' && isValid(parseISO(expenseData.date)) 
            ? Timestamp.fromDate(parseISO(expenseData.date)) 
            : (expenseData.date instanceof Date ? Timestamp.fromDate(expenseData.date) 
            : (expenseData.date instanceof Timestamp ? expenseData.date : serverTimestamp())),
    _internalCategoryKey: expenseData._internalCategoryKey || null,
  });

  if (expenseData.id) { // Update existing
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseData.id);
    await updateDoc(docRef, { ...dataToSave, lastUpdatedAt: serverTimestamp() });
    return expenseData.id;
  } else { // Create new
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    await setDoc(newDocRef, { ...dataToSave, id: newDocRef.id, createdAt: serverTimestamp() });
    return newDocRef.id;
  }
}


export async function deleteOtherExpenseService(expenseId: string, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required for deleteOtherExpenseService.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const docSnap = await getDoc(docRef); 
    if (!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Expense not found or permission denied.");
    }
    await deleteDoc(docRef);
}

export async function getExpenseCategoriesService(userId: string): Promise<ExpenseCategory[]> {
  if (!db || !userId) return [];
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(categoriesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseCategory));
}

export async function saveExpenseCategoryService(categoryData: Omit<ExpenseCategory, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveExpenseCategoryService.");
  if (!categoryData.name || !categoryData.internalKey) throw new Error("Category name and internalKey are required.");

  const q = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), where("internalKey", "==", categoryData.internalKey));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Expense category with key "${categoryData.internalKey}" already exists for this user.`);
  }

  const newDocRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
  await setDoc(newDocRef, sanitizeForFirestore({ 
      ...categoryData, 
      id: newDocRef.id,
      userId, 
      createdAt: serverTimestamp(), 
      isFixed: categoryData.isFixed ?? false, // Default to false
      defaultAmount: categoryData.defaultAmount ?? null,
    }));
  return newDocRef.id;
}

export async function getExpenseTemplatesService(userId: string): Promise<ExpenseTemplate[]> {
  if (!db || !userId) return [];
  const templatesQuery = query(collection(db, EXPENSE_TEMPLATES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(templatesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseTemplate));
}

export async function saveExpenseTemplateService(templateData: Omit<ExpenseTemplate, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveExpenseTemplateService.");
  const newDocRef = doc(collection(db, EXPENSE_TEMPLATES_COLLECTION));
  await setDoc(newDocRef, sanitizeForFirestore({ ...templateData, id: newDocRef.id, userId, createdAt: serverTimestamp() }));
  return newDocRef.id;
}


// --- Temporary Data Management for Uploads (localStorage) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    console.log(`[clearTemporaryScanData] Attempting to clear keys for UserID: ${userId}, ScanID: ${uniqueScanId}`);
    try {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const originalImageKey = getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const compressedImageKey = getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
      console.log(`[clearTemporaryScanData] Cleared keys: ${dataKey}, ${originalImageKey}, ${compressedImageKey}`);
    } catch (error) {
        console.error(`Error removing temp keys for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
    }
}

export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; 
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue; 
        }

        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) {
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All Relevant'}).`);
}

// Placeholder for a potential service to save accountant settings to Firestore if needed
export async function saveAccountantSettingsService(settings: AccountantSettings, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("User authentication required to save accountant settings.");
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  await setDoc(userSettingsRef, { accountantSettings: sanitizeForFirestore(settings) }, { merge: true });
}

// Placeholder for a potential service to get accountant settings from Firestore
export async function getAccountantSettingsService(userId: string): Promise<AccountantSettings | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists() && docSnap.data().accountantSettings) {
    return docSnap.data().accountantSettings as AccountantSettings;
  }
  return null;
}

// Placeholder for POS settings if they were to be stored in Firestore
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("User authentication required to save POS settings.");
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  await setDoc(userSettingsRef, { posSystemId: systemId, posConfig: sanitizeForFirestore(config) }, { merge: true });
}

export async function getPosSettingsService(userId: string): Promise<{ systemId: string; config: PosConnectionConfig } | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    if (data.posSystemId && data.posConfig) {
      return { systemId: data.posSystemId, config: data.posConfig };
    }
  }
  return null;
}
