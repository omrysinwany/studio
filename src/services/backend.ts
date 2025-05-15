
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
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

// Firestore Collection Names
const USERS_COLLECTION = "users";
export const INVENTORY_COLLECTION = "inventoryProducts"; // Exporting for potential direct use if needed elsewhere
export const DOCUMENTS_COLLECTION = "documents"; // Exporting
export const SUPPLIERS_COLLECTION = "suppliers"; // Exporting
const OTHER_EXPENSES_COLLECTION = "otherExpenses";
const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories";
const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates";
const USER_SETTINGS_COLLECTION = "userSettings";


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
  barcode?: string;
  quantity: number;
  unitPrice: number;
  salePrice?: number;
  lineTotal: number;
  minStockLevel?: number;
  maxStockLevel?: number;
  imageUrl?: string;
  _originalId?: string; // Used to track original ID from scan if it differs from inventory ID
  lastUpdated?: Timestamp | FieldValue;
}

export interface InvoiceHistoryItem {
  id: string;
  userId: string;
  originalFileName: string; // Original name of the uploaded file
  generatedFileName: string; // Name generated (e.g., Supplier_InvoiceNumber)
  uploadTime: string | Timestamp; // ISO string or Firestore Timestamp
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string | Timestamp; // Date on the invoice itself
  totalAmount?: number;
  paymentMethod?: string;
  paymentDueDate?: string | Timestamp;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string; // URI to the uploaded payment receipt image (e.g., Firebase Storage URL)
  originalImagePreviewUri?: string; // Data URI for small preview, or Firebase Storage URL
  compressedImageForFinalRecordUri?: string; // Firebase Storage URL for the "official" image
  errorMessage?: string;
  linkedDeliveryNoteId?: string; // If this is a payment receipt linked to a delivery note/invoice
}


export interface DocumentLineItem {
  // Not directly stored as a separate collection in this iteration,
  // but represents the structure of items within a scanned document if we were to store them.
  // For now, product details from scans are directly used to update/create `InventoryProducts`.
  documentId?: string; // FK to Documents
  userId?: string; // FK to Users
  productId?: string; // FK to InventoryProducts (if matched)
  productName: string; // Name as it appeared on the document
  catalogNumber?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number; // Cost price from document
  lineTotal: number;
  shortProductName?: string;
}


export interface SupplierSummary {
  id: string;
  userId: string;
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  lastActivityDate?: string | Timestamp;
  createdAt: Timestamp | FieldValue;
}

export interface AccountantSettings {
  name?: string;
  email?: string;
  phone?: string;
}

export interface UserSettings {
  userId: string;
  reminderDaysBefore?: number; // For payment due date reminders
  // POS Integration Settings
  posSystemId?: string;
  posConfig?: PosConnectionConfig;
  // Accountant Details
  accountantSettings?: AccountantSettings;
  // Budget
  monthlyBudget?: number;
  // Dashboard Preferences
  kpiPreferences?: { visibleKpiIds: string[], kpiOrder: string[] };
  quickActionPreferences?: { visibleQuickActionIds: string[], quickActionOrder: string[] };

}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp; // ISO string or Firestore Timestamp
  category: string; // User-defined category name
  _internalCategoryKey?: string; // Machine-friendly key, e.g., 'electricity', 'rent'
}

export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  category: string; // Should match a category name or key
  description: string;
  amount: number;
}


// Storage Keys for localStorage (temporary data, settings not yet in Firestore)
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory';
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoiceHistory';
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
export const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories';
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';


// --- Storage Keys for temporary data during scan process ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// --- Storage Limits ---
// Max size for the original image preview stored in localStorage (e.g., for the edit page)
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024; // 0.4MB
// Max size for the AI scan results JSON string stored in localStorage
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
// Max number of invoice history items to keep in localStorage (if we were still using it for that)
// For Firestore, this limit is not directly applied in client-side storage.
export const MAX_INVOICE_HISTORY_ITEMS = 50;


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
    console.warn(`[getStorageKey] Attempted to get storage key for base "${baseKey}" without a userId. Returning a generic key.`);
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
      // Ensure items have an ID
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
  if (!userId) {
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
        clearOldTemporaryScanData(true, userId); // Attempt emergency clear for this user
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`Successfully saved to localStorage after cleanup for key ${storageKey}`);
        return true;
      } catch (retryError) {
        console.error(`Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        // Potentially throw a more specific error to be caught by UI
        throw new Error(`Failed to save data after cleanup due to storage quota: ${(retryError as Error).message}`);
      }
    } else {
      // For other errors, re-throw them to be handled by the calling function
      throw new Error(`Failed to save data: ${(error as Error).message}`);
    }
  }
  return false; // Should not be reached if an error is thrown
};


// --- User Management ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot save user.");
    throw new Error("Database not initialized.");
  }
  if (!userData.id) {
    console.error("User data must include an ID (Firebase UID).");
    throw new Error("User ID is missing.");
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, userData.id);
    const dataToSave: Partial<User> = { ...userData };
    // Check if user already exists to set createdAt only on new user creation
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp(); // Set only if new user
    }
    dataToSave.lastLoginAt = serverTimestamp(); // Always update lastLoginAt
    await setDoc(userRef, dataToSave, { merge: true });
  } catch (error) {
    console.error("Error saving user to Firestore:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

export async function getUserFromFirestore(userId: string): Promise<User | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get user.");
    return null;
  }
  try {
    const userRef = doc(db, USERS_COLLECTION, userId);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        username: data.username,
        email: data.email,
        // Convert Firestore Timestamps to JS Date objects or keep as Timestamps based on need
        createdAt: data.createdAt, // This will be a Firestore Timestamp
        lastLoginAt: data.lastLoginAt, // This will be a Firestore Timestamp
      } as User;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Inventory Product Management ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get products.");
    return [];
  }
  if (!userId) {
    console.warn("getProductsService called without userId. Returning empty array.");
    return [];
  }
  try {
    const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get product by ID.");
    return null;
  }
  if (!userId) return null; // Or throw error
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      return { id: docSnap.id, ...docSnap.data() } as Product;
    }
    console.log(`Product with ID ${productId} not found for user ${userId}.`);
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Product>, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot update product.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    // Before updating, ensure the product belongs to the user (optional, depends on security rules strength)
    // const productDoc = await getDoc(productRef);
    // if (!productDoc.exists() || productDoc.data().userId !== userId) {
    //   throw new Error("Permission denied or product not found.");
    // }
    await updateDoc(productRef, { ...updatedData, userId, lastUpdated: serverTimestamp() }); // Ensure userId is part of update for rules
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot delete product.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    // Optional: Verify ownership before deleting if rules aren't enough
    // const productDoc = await getDoc(productRef);
    // if (!productDoc.exists() || productDoc.data().userId !== userId) {
    //   throw new Error("Permission denied or product not found.");
    // }
    await deleteDoc(productRef);
  } catch (error) {
    console.error(`Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot clear inventory.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    // Firestore doesn't support deleting a collection directly from client-side.
    // Need to fetch all documents and delete them in a batch.
    const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(productsQuery);
    const batchOp = writeBatch(db);
    snapshot.docs.forEach(doc => batchOp.delete(doc.ref));
    await batchOp.commit();
  } catch (error) {
    console.error("Error clearing inventory from Firestore:", error);
    throw error;
  }
}

// --- Document (Invoice/Delivery Note) Management ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get documents.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId. Returning empty array.");
    return [];
  }
  try {
    // Assuming documents are ordered by uploadTime descending in the page
    const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InvoiceHistoryItem));
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot update document.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    await updateDoc(docRef, { ...updatedData, userId }); // Ensure userId is part of update for rules
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    const updateData: Partial<InvoiceHistoryItem> = { paymentStatus, userId };
    if (paymentStatus === 'paid' && paymentReceiptImageUri) {
      updateData.paymentReceiptImageUri = paymentReceiptImageUri;
    } else if (paymentStatus !== 'paid') {
      // If changing status away from 'paid', remove the receipt URI
      updateData.paymentReceiptImageUri = deleteField() as any; // Use deleteField() to remove the field
    }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot delete document.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    // Optional: Verify ownership
    // const docSnap = await getDoc(docRef);
    // if (!docSnap.exists() || docSnap.data().userId !== userId) {
    //   throw new Error("Permission denied or document not found.");
    // }
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
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication required for price check.");

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    // A product is "new" for this check if it doesn't have a persistent ID or has a temporary one.
    // Its price won't be checked against existing inventory here; merge logic might happen in finalizeSave.
    if (!product.id || product.id.startsWith('prod-temp-') || product.id.includes('-new')) {
      productsToSaveDirectly.push(product);
      continue;
    }

    const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
    const existingProductSnap = await getDoc(existingProductRef);

    if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
      const existingProductData = existingProductSnap.data() as Product;
      // Check for actual price difference, accounting for potential floating point inaccuracies.
      if (existingProductData.unitPrice !== undefined && product.unitPrice !== undefined &&
          Math.abs(existingProductData.unitPrice - product.unitPrice) > 0.001) { // Allow small floating point differences
        priceDiscrepancies.push({
          ...product,
          existingUnitPrice: existingProductData.unitPrice,
          newUnitPrice: product.unitPrice, // The price from the current scan/edit
        });
      } else {
        // Prices are the same or one is undefined, save directly
        productsToSaveDirectly.push(product);
      }
    } else {
      // Product not found by this ID or doesn't belong to user, treat as if new for price check.
      productsToSaveDirectly.push(product);
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}



// --- Save Scanned/Edited Document and Update Inventory ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string, // This might be a client-generated temp ID or an actual Firestore ID if retrying
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string | Date,
    invoiceDate?: string | Date | Timestamp,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string, // Could be data URI or null
    compressedImageForFinalRecordUriToSave?: string // Could be data URI or null
): Promise<{
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {
    if (!db) {
      console.error("Firestore (db) is not initialized. Cannot finalize save.");
      throw new Error("Database not initialized.");
    }
    if (!userId) {
      console.error("User ID is missing. Cannot finalize save.");
      throw new Error("User authentication is required to save products and invoice history.");
    }
    console.log(`[finalizeSaveProductsService] Starting. UserID: ${userId}, DocumentType: ${documentType}, TempInvoiceID: ${tempInvoiceId}`);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;

    // Use a transaction to ensure atomicity if multiple operations are dependent
    // However, for simplicity here, we'll use batched writes.
    // For true atomicity across collections and complex logic, Cloud Functions might be better.
    const batchOp = writeBatch(db);

    // Only process products for inventory if it's a delivery note OR
    // if it's a POS sync (indicated by tempInvoiceId containing '_sync')
    const shouldUpdateInventory = documentType === 'deliveryNote' || (tempInvoiceId && tempInvoiceId.includes('_sync'));

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        console.log(`[finalizeSaveProductsService] Processing ${productsToFinalizeSave.length} products for inventory update.`);
        for (const productToSave of productsToFinalizeSave) {
            const quantityFromDoc = parseFloat(String(productToSave.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productToSave.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productToSave.lineTotal)) || 0;

            // If unit price is zero but line total and quantity suggest a price, calculate it
            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0 && (lineTotalFromDoc / quantityFromDoc > 0)) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductSnap;
            let existingProductRef;
            let foundBy = "";

            // 1. Try to find by persistent ID (if provided and not temporary)
            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productToSave.id);
                existingProductSnap = await getDoc(existingProductRef);
                if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
                    foundBy = `ID (${productToSave.id})`;
                } else {
                    existingProductSnap = undefined; // Not user's or doesn't exist by this ID
                }
            }

            // 2. If not found by ID, try by catalog number
            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productToSave.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductSnap = catSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                    foundBy = `Catalog (${productToSave.catalogNumber})`;
                }
            }

            // 3. If not found by ID or catalog, try by barcode
            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.barcode && productToSave.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productToSave.barcode), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductSnap = barSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                    foundBy = `Barcode (${productToSave.barcode})`;
                }
            }

            const productDataForFirestore: Partial<Product> = { // Use Partial for update, Omit for set
                userId,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                barcode: productToSave.barcode === null ? undefined : (productToSave.barcode?.trim() === '' ? undefined : productToSave.barcode),
                // unitPrice will be handled based on existing or new
                // salePrice, minStockLevel, maxStockLevel, imageUrl will be handled based on existing or new
                lastUpdated: serverTimestamp()
            };

            if (existingProductSnap && existingProductSnap.exists() && existingProductRef) {
                console.log(`[finalizeSaveProductsService] Found existing product by ${foundBy}. ID: ${existingProductRef.id}. Merging data.`);
                const existingData = existingProductSnap.data() as Product;

                // For delivery notes, add quantity. For POS sync, overwrite quantity.
                const updatedQuantity = (documentType === 'deliveryNote' && !(tempInvoiceId && tempInvoiceId.includes('_sync')))
                    ? (existingData.quantity || 0) + quantityFromDoc
                    : quantityFromDoc;

                const finalUnitPrice = (unitPriceFromDoc > 0) ? unitPriceFromDoc : (existingData.unitPrice || 0);

                const updatePayload: Partial<Product> = {
                    ...productDataForFirestore, // base fields
                    quantity: updatedQuantity,
                    unitPrice: finalUnitPrice,
                    lineTotal: parseFloat(((updatedQuantity || 0) * finalUnitPrice).toFixed(2)), // Recalculate lineTotal based on potentially new quantity/price
                    salePrice: productToSave.salePrice !== undefined ? productToSave.salePrice : existingData.salePrice,
                    minStockLevel: productToSave.minStockLevel !== undefined ? productToSave.minStockLevel : existingData.minStockLevel,
                    maxStockLevel: productToSave.maxStockLevel !== undefined ? productToSave.maxStockLevel : existingData.maxStockLevel,
                    imageUrl: productToSave.imageUrl !== undefined ? productToSave.imageUrl : existingData.imageUrl,
                };
                batchOp.update(existingProductRef, updatePayload);
                savedProductsWithFinalIds.push({ ...existingData, ...updatePayload, id: existingProductRef.id });
            } else {
                console.log(`[finalizeSaveProductsService] Product not found, creating new. Catalog: ${productDataForFirestore.catalogNumber}, Barcode: ${productDataForFirestore.barcode}`);
                 if (!productDataForFirestore.catalogNumber && !productDataForFirestore.description && !productDataForFirestore.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping product with no identifier:", productToSave);
                    continue;
                }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                const newProductData: Product = {
                    ...productDataForFirestore,
                    id: newProductRef.id, // Firestore generates ID if not set, but good to have for return
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc,
                    lineTotal: parseFloat((quantityFromDoc * unitPriceFromDoc).toFixed(2)),
                    salePrice: productToSave.salePrice,
                    minStockLevel: productToSave.minStockLevel,
                    maxStockLevel: productToSave.maxStockLevel,
                    imageUrl: productToSave.imageUrl,
                } as Product;
                batchOp.set(newProductRef, newProductData);
                savedProductsWithFinalIds.push({ ...newProductData }); // ID will be from newProductRef.id
            }
        }
    } else {
        console.log(`[finalizeSaveProductsService] Document type is '${documentType}' and not a POS sync. Inventory not updated. Calculating total from input products if any.`);
        productsToFinalizeSave.forEach(productToSave => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productToSave.lineTotal)) || 0);
        });
    }

    let finalInvoiceRecord: InvoiceHistoryItem | undefined = undefined;
    const finalStatus: InvoiceHistoryItem['status'] = 'completed';
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
    finalGeneratedFileName = finalGeneratedFileName.replace(/[/\\?%*:|"<>]/g, '-');

    const currentUploadTime = Timestamp.now(); // Use Firestore Timestamp for consistency

    const documentData: Omit<InvoiceHistoryItem, 'id'> = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: currentUploadTime,
        status: finalStatus,
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || undefined,
        supplierName: finalSupplierName || undefined,
        totalAmount: finalInvoiceTotalAmount,
        originalImagePreviewUri: originalImagePreviewUriToSave || undefined, // Store as undefined if null/empty
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || undefined,
        paymentStatus: 'unpaid', // Default for new documents
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' ? Timestamp.fromDate(parseISO(paymentDueDate)) : undefined),
        invoiceDate: invoiceDate instanceof Timestamp ? invoiceDate : (invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' ? Timestamp.fromDate(parseISO(invoiceDate)) : undefined)),
        paymentMethod: paymentMethod || undefined,
        errorMessage: undefined, // Should be clear if status is completed
    };

    let docRef;
    let isNewDocument = true;
    const uniqueScanIdFromTemp = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : (tempInvoiceId && !tempInvoiceId.includes('_sync') ? tempInvoiceId : null) ; // Handle POS sync IDs differently

    if (uniqueScanIdFromTemp && !tempInvoiceId?.includes('_sync')) {
        // If it's a pending ID from client, we still create a new document in Firestore.
        // The tempInvoiceId was only for client-side tracking.
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] Creating new document in Firestore for client-side tempId: ${tempInvoiceId}. New Firestore ID: ${docRef.id}`);
    } else if (tempInvoiceId) {
        // This tempInvoiceId IS an actual Firestore ID (e.g., from POS sync or a previous save attempt that generated a Firestore ID)
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        const existingDocSnap = await getDoc(docRef); // Check if it actually exists
        isNewDocument = !existingDocSnap.exists();
        console.log(`[finalizeSaveProductsService] Using provided tempInvoiceId as Firestore doc ID: ${tempInvoiceId}. Is new document: ${isNewDocument}`);
    } else {
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] No tempInvoiceId provided, creating new document in Firestore. New Firestore ID: ${docRef.id}`);
    }

    if (isNewDocument) {
        batchOp.set(docRef, documentData);
    } else {
        // If document exists, merge new data. Be careful about overwriting intentional nulls.
        // Using updateDoc with specific fields might be safer if only certain fields should change.
        // For now, set with merge is okay if the documentData is comprehensive.
        batchOp.set(docRef, documentData, { merge: true });
    }
    finalInvoiceRecord = { ...documentData, id: docRef.id };

    try {
      console.log("[finalizeSaveProductsService] Committing batch operation to Firestore...");
      await batchOp.commit();
      console.log("[finalizeSaveProductsService] Batch commit successful.");
    } catch (error) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      // Attempt to clear temporary localStorage data if a Firestore save fails and we had a uniqueScanId
      if (uniqueScanIdFromTemp) {
        console.warn(`[finalizeSaveProductsService] Firestore save failed, attempting to clear temporary localStorage data for scan ID: ${uniqueScanIdFromTemp}`);
        clearTemporaryScanData(uniqueScanIdFromTemp, userId);
      }
      throw error; // Re-throw the original error
    }
    // If successful, clear temporary localStorage data
    if (uniqueScanIdFromTemp) {
       clearTemporaryScanData(uniqueScanIdFromTemp, userId);
    }

    return { finalInvoiceRecord, savedProductsWithFinalIds };
}


// --- Supplier Management ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get supplier summaries.");
    return [];
  }
  if (!userId) {
    console.warn("[getSupplierSummariesService] No userId provided. Returning empty array.");
    return [];
  }

  const suppliersQuery = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId));
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), where("status", "==", "completed"));

  try {
    const [suppliersSnapshot, documentsSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery)
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      supplierMap.set(data.name, {
        id: docSnap.id,
        userId,
        name: data.name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        paymentTerms: data.paymentTerms || undefined,
        invoiceCount: 0, // Will be calculated from documents
        totalSpent: 0,   // Will be calculated from documents
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : data.lastActivityDate,
        createdAt: data.createdAt, // Firestore Timestamp
      });
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem;
      if (docData.supplierName) {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (supplierEntry) {
          supplierEntry.invoiceCount += 1;
          supplierEntry.totalSpent += (docData.totalAmount || 0);
          const docUploadTime = docData.uploadTime ? (docData.uploadTime instanceof Timestamp ? docData.uploadTime.toDate() : parseISO(docData.uploadTime as string)) : null;

          if (docUploadTime) {
            const currentLastActivity = supplierEntry.lastActivityDate ? parseISO(supplierEntry.lastActivityDate as string) : null;
            if (!currentLastActivity || docUploadTime > currentLastActivity) {
              supplierEntry.lastActivityDate = docUploadTime.toISOString();
            }
          }
        } else {
          // If a document has a supplier not in the suppliers collection, create a temporary entry.
          // This can happen if suppliers are only added implicitly via documents.
           const newTempSupplier: SupplierSummary = {
                id: `temp-${docData.supplierName.replace(/\s+/g, '_')}-${Date.now()}`, // Temporary ID
                userId,
                name: docData.supplierName,
                invoiceCount: 1,
                totalSpent: docData.totalAmount || 0,
                lastActivityDate: docData.uploadTime ? (docData.uploadTime instanceof Timestamp ? docData.uploadTime.toDate().toISOString() : docData.uploadTime as string) : undefined,
                createdAt: docData.uploadTime || serverTimestamp(), // Use document upload time or current
            };
            supplierMap.set(docData.supplierName, newTempSupplier);
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
  if (!userId) throw new Error("User authentication is required.");

  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  // Check if supplier with the same name already exists for this user
  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Supplier with name "${normalizedName}" already exists for this user.`);
  }

  const newSupplierData = {
    userId,
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null, // Store as null if empty for Firestore
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0, // Initial values
    totalSpent: 0,
    lastActivityDate: null,
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), newSupplierData);
  // Return the created object including its ID and resolved timestamp
  return { ...newSupplierData, id: docRef.id, createdAt: Timestamp.now() } as SupplierSummary; // Cast to ensure type match
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  const docRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  // Optional: Verify ownership before deleting if rules aren't fully restrictive yet
  const supplierDoc = await getDoc(docRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error("Supplier not found or permission denied.");
  }
  await deleteDoc(docRef);
}


export async function updateSupplierContactInfoService(supplierIdOrName: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  let supplierRef;
  // Try to get by ID first
  const docByIdRef = doc(db, SUPPLIERS_COLLECTION, supplierIdOrName);
  let supplierDoc = await getDoc(docByIdRef);

  if (supplierDoc.exists() && supplierDoc.data()?.userId === userId) {
    supplierRef = supplierDoc.ref;
  } else {
    // If not found by ID (or ID was actually a name), try to find by name
    const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", supplierIdOrName), limit(1));
    const nameQuerySnap = await getDocs(q);
    if (!nameQuerySnap.empty) {
      supplierRef = nameQuerySnap.docs[0].ref;
    } else {
      throw new Error(`Supplier "${supplierIdOrName}" not found for this user.`);
    }
  }

  const updateData: any = { userId }; // Always ensure userId for rules consistency
  let hasChanges = false;
  if (contactInfo.phone !== undefined) { updateData.phone = contactInfo.phone.trim() || null; hasChanges = true; }
  if (contactInfo.email !== undefined) { updateData.email = contactInfo.email.trim() || null; hasChanges = true; }
  if (contactInfo.paymentTerms !== undefined) { updateData.paymentTerms = contactInfo.paymentTerms.trim() || null; hasChanges = true; }

  if (hasChanges) {
    await updateDoc(supplierRef, updateData);
  }
}


// --- Settings Management (POS, Accountant, General User Settings) ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    // Ensure the structure being saved is what's expected by UserSettings interface
    await setDoc(userSettingsRef, { posSystemId: systemId, posConfig: config, userId }, { merge: true });
}

export async function getPosSettingsService(userId: string): Promise<{ systemId: string; config: PosConnectionConfig } | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists() && docSnap.data().posSystemId) {
    const data = docSnap.data();
    return { systemId: data.posSystemId, config: data.posConfig || {} };
  }
  return null;
}

export async function clearPosSettingsService(userId: string): Promise<void> { // This wasn't used but good to have
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await updateDoc(userSettingsRef, {
        posSystemId: deleteField(), // Use deleteField to remove
        posConfig: deleteField()
    });
}

export async function saveAccountantSettingsService(settings: AccountantSettings, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { accountantSettings: settings, userId }, { merge: true });
}

export async function getAccountantSettingsService(userId: string): Promise<AccountantSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        return docSnap.data().accountantSettings || null;
    }
    return null;
}

export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { ...settings, userId }, { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        return { userId, ...docSnap.data() } as UserSettings;
    }
    // Return a default structure if no settings doc exists, ensuring userId is present
    return {
        userId,
        reminderDaysBefore: 3, // Default example
        posSystemId: undefined,
        posConfig: {},
        accountantSettings: {},
        monthlyBudget: undefined,
        kpiPreferences: undefined,
        quickActionPreferences: undefined,
    };
}


// --- Temporary Data Management for Uploads ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !uniqueScanId || !userId) return;
    const dataKey = `${TEMP_DATA_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const originalImageKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${userId}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${userId}_${uniqueScanId}`;
    try {
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
      console.log(`[clearTemporaryScanData] Cleared temp keys for UserID: ${userId}, ScanID: ${uniqueScanId}`);
    } catch (error) {
        console.error(`Error removing temp keys for UserID: ${userId}, ScanID: ${uniqueScanId}`, error);
    }
}

export function clearOldTemporaryScanData(emergencyClear: boolean = false, userIdToClear?: string) {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
        // If a specific user ID is provided, only clear their data
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue;
        }

        const parts = key.split('_');
        // A more robust way to find timestamp might be needed if key structure varies widely
        const timestampString = parts.find(part => /^\d{13,}$/.test(part)); // Find a part that looks like a 13-digit timestamp
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        // If emergencyClear is true, clear it regardless of expiry if it belongs to the user (or if no user specified)
        // Otherwise, only clear if expired
        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) { // Avoid clearing "shared" keys in emergency unless explicitly for a user
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All'}).`);
}
