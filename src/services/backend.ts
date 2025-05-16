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
// ExpenseTemplates are currently localStorage based as per current design
// export const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates"; 
export const USER_SETTINGS_COLLECTION = "userSettings";


export interface User {
  id: string;
  username?: string | null; // Allow null for username
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string;
  userId?: string;
  catalogNumber: string;
  description: string;
  shortName?: string | null;
  barcode?: string | null;
  quantity: number;
  unitPrice: number;
  salePrice?: number | null;
  lineTotal: number;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  _originalId?: string; // Used during edit flow to track original ID from scan
  lastUpdated?: Timestamp | FieldValue;
}

export interface InvoiceHistoryItem {
  id: string;
  userId: string;
  originalFileName: string;
  generatedFileName: string; // Name to be used for the final record, e.g., Supplier_InvoiceNumber
  uploadTime: string | Timestamp; // ISO string or Firestore Timestamp
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt'; // Added paymentReceipt
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | null; // Date on the invoice itself
  totalAmount?: number | null;
  paymentMethod?: string | null;
  paymentDueDate?: string | Timestamp | null;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string | null; // URI for the uploaded payment receipt image
  originalImagePreviewUri?: string | null; // URI for the original scanned image preview (localStorage or Storage)
  compressedImageForFinalRecordUri?: string | null; // URI for compressed image for final record (Storage)
  errorMessage?: string | null;
  linkedDeliveryNoteId?: string | null; // For linking payment receipts to delivery notes/invoices
}


// Keep SupplierSummary for list views
export interface SupplierSummary {
  id: string;
  userId: string;
  name: string;
  invoiceCount: number;
  totalSpent: number;
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null; // Added payment terms
  lastActivityDate?: string | Timestamp | null; // ISO string or Firestore Timestamp
  createdAt: Timestamp | FieldValue;
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
  userId: string; // Should match the auth UID
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: KpiPreferences | null;
  quickActionPreferences?: QuickActionPreferences | null;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp; // ISO string for input, Timestamp for Firestore
  category: string; // User-facing category name
  _internalCategoryKey?: string | null; // For special categories like 'rent', 'property_tax'
  categoryId?: string | null; // Link to ExpenseCategory if using a separate collection
}

export interface ExpenseCategory {
  id: string;
  userId: string;
  name: string;          // User-defined name (e.g., "Electricity Bill")
  internalKey: string;   // System key (e.g., "electricity", "water", or user-defined like "marketing_materials")
  isFixed?: boolean;      // Is this a fixed recurring expense?
  defaultAmount?: number | null; // For fixed expenses like rent/property tax
  createdAt: Timestamp | FieldValue;
}


// ExpenseTemplates are currently localStorage based as per current design
// If migrating to Firestore, the interface would be:
export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  categoryKey: string; // internalKey of the category
  description: string;
  amount: number;
  createdAt: Timestamp | FieldValue;
}


// localStorage keys for temporary scan data
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// localStorage related constants (consider removing these if all data moves to Firestore)
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.25 * 1024 * 1024; // 0.25MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.4 * 1024 * 1024; // 0.4MB
export const MAX_INVOICE_HISTORY_ITEMS = 10; // For upload history display using localStorage


// --- Helper function to get localStorage keys with userId ---
export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    // For preferences that might be loaded before user context is fully established
    if ([KPI_PREFERENCES_STORAGE_KEY_BASE, QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE].includes(baseKey)) {
        return baseKey; // Allow these to be potentially non-user-specific initially
    }
    // console.warn(`[getStorageKey] Called with base "${baseKey}" but no userId.`);
    return `${baseKey}_SHARED_OR_NO_USER`; // Fallback, less ideal
  }
  return `${baseKey}_${userId}`;
};

export const getStoredData = <T>(keyBase: string, userId?: string, defaultDataIfNoUserOrError: T | T[] = []): T | T[] => {
  if (typeof window === 'undefined') return defaultDataIfNoUserOrError;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
    return defaultDataIfNoUserOrError;
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage:`, error);
    return defaultDataIfNoUserOrError;
  }
};

const saveStoredData = (keyBase: string, data: any, userId?: string): boolean => {
  if (typeof window === 'undefined') return false;
  const storageKey = getStorageKey(keyBase, userId);
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch (error: any) {
    console.error(`Error writing to localStorage for key ${storageKey}:`, error);
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.message.includes('exceeded the quota'))) {
      console.warn(`Quota exceeded for key ${storageKey}. Attempting to clear old temporary scan data and retry...`);
      try {
        clearOldTemporaryScanData(true, userId); // Emergency clear for current user
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
        (genericError as any).isQuotaError = false; // Mark that it's not a quota error
        throw genericError;
    }
  }
};

// Helper to sanitize data for Firestore (replace undefined with null)
export function sanitizeForFirestore<T extends object>(data: T): T {
  const sanitizedData = { ...data } as Record<string, any>;
  for (const key in sanitizedData) {
    if (sanitizedData[key] === undefined) {
      sanitizedData[key] = null; // Firestore prefers null over undefined
    }
  }
  return sanitizedData as T;
}


// --- User Management (Firestore) ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) {
    console.error("Firestore (db) is not initialized in saveUserToFirestore.");
    throw new Error("Database not initialized.");
  }
  if (!userData.id) {
    console.error("User ID is missing for saveUserToFirestore.");
    throw new Error("User ID is missing.");
  }
  
  const userRef = doc(db, USERS_COLLECTION, userData.id);
  const dataToSave: Partial<User> = {
    email: userData.email || null,
    username: userData.username || null,
    // Timestamps are handled by serverTimestamp or existing values
  };
  
  try {
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
      console.log(`[saveUserToFirestore] User ${userData.id} does not exist, setting createdAt.`);
    }
    dataToSave.lastLoginAt = serverTimestamp();
    console.log(`[saveUserToFirestore] Saving/updating user ${userData.id} with data:`, dataToSave);
    await setDoc(userRef, sanitizeForFirestore(dataToSave), { merge: true });
    console.log(`[saveUserToFirestore] User ${userData.id} saved/updated successfully.`);
  } catch (error) {
    console.error("[saveUserToFirestore] Error saving user to Firestore:", error);
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
      const data = docSnap.data();
      return { 
        id: docSnap.id, 
        ...data,
        email: data.email || null, // Ensure null if undefined
        username: data.username || null, // Ensure null if undefined
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt : undefined, // Keep as Timestamp or undefined
        lastLoginAt: data.lastLoginAt instanceof Timestamp ? data.lastLoginAt : undefined, // Keep as Timestamp or undefined
      } as User;
    }
    console.log(`[getUserFromFirestore] No user found with ID: ${userId}`);
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error; // Re-throw to be handled by caller
  }
}

// --- Inventory Products (Firestore) ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getProductsService.");
    return [];
  }
  if (!userId) {
    console.warn("getProductsService called without userId. Returning empty array.");
    return [];
  }
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), orderBy("shortName"));
  try {
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        ...docSnap.data(),
        lastUpdated: docSnap.data().lastUpdated instanceof Timestamp ? docSnap.data().lastUpdated : undefined,
    } as Product));
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for products. Please create the suggested index in your Firebase console (check browser console for the link).");
    }
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db || !userId) return null;
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  try {
    const docSnap = await getDoc(productRef);
    if (docSnap.exists() && docSnap.data().userId === userId) {
      const data = docSnap.data();
      return { 
          id: docSnap.id, 
          ...data,
          lastUpdated: data.lastUpdated instanceof Timestamp ? data.lastUpdated : undefined,
      } as Product;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function updateProductService(productId: string, updatedData: Partial<Omit<Product, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  const dataToUpdate: Partial<Omit<Product, 'id' | 'userId'>> & { lastUpdated: FieldValue } = {
    ...sanitizeForFirestore(updatedData),
    lastUpdated: serverTimestamp()
  };

  try {
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
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
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

// Helper function to delete all documents in a collection for a specific user
export async function deleteCollectionByUserId(collectionName: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing for deleteCollectionByUserId.");
  
  const q = query(collection(db, collectionName), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    console.log(`[deleteCollectionByUserId] No documents to delete in ${collectionName} for user ${userId}.`);
    return;
  }

  const batch = writeBatch(db);
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log(`[deleteCollectionByUserId] All documents in ${collectionName} for user ${userId} have been deleted.`);
}


export async function clearInventoryService(userId: string): Promise<void> {
  await deleteCollectionByUserId(INVENTORY_COLLECTION, userId);
}

// --- Documents (Invoices/Delivery Notes - Firestore) ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized in getInvoicesService.");
    return [];
  }
  if (!userId) {
    console.warn("getInvoicesService called without userId. Returning empty array.");
    return [];
  }
  
  const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
  try {
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        // Helper to convert Firestore Timestamps to ISO strings, or pass through if already string/null
        const convertTimestampToString = (field: any): string | null => {
            if (field instanceof Timestamp) return field.toDate().toISOString();
            if (typeof field === 'string' && isValid(parseISO(field))) return field; // Already an ISO string
            if (field instanceof Date && isValid(field)) return field.toISOString(); // JS Date object
            return null; // Or field if it could be other types and you want to preserve them
        };
        return {
            id: docSnap.id, 
            ...data,
            uploadTime: convertTimestampToString(data.uploadTime), // Ensure it's always string or null for UI
            invoiceDate: convertTimestampToString(data.invoiceDate),
            paymentDueDate: convertTimestampToString(data.paymentDueDate),
        } as InvoiceHistoryItem;
    });
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
     if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for documents. Firebase usually provides a link in the error message to create it. Check the browser console for the full error.");
    }
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<Omit<InvoiceHistoryItem, 'id' | 'userId'>>, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  
  // Prepare data for Firestore, converting date strings to Timestamps
  const dataToUpdate: any = { ...updatedData }; 
  const convertToTimestampIfValidString = (dateField: any): Timestamp | null => {
    if (dateField && typeof dateField === 'string' && isValid(parseISO(dateField))) {
      return Timestamp.fromDate(parseISO(dateField));
    }
    if (dateField instanceof Date && isValid(dateField)) return Timestamp.fromDate(dateField); // Handle JS Date
    return dateField instanceof Timestamp ? dateField : null; // Keep if already Timestamp, else null
  };

  // Convert date fields to Timestamps if they are provided as strings
  if (dataToUpdate.hasOwnProperty('invoiceDate')) dataToUpdate.invoiceDate = convertToTimestampIfValidString(dataToUpdate.invoiceDate);
  if (dataToUpdate.hasOwnProperty('paymentDueDate')) dataToUpdate.paymentDueDate = convertToTimestampIfValidString(dataToUpdate.paymentDueDate);
  if (dataToUpdate.hasOwnProperty('uploadTime')) { // Though uploadTime is usually set by serverTimestamp on create
    dataToUpdate.uploadTime = convertToTimestampIfValidString(dataToUpdate.uploadTime);
  }
  
  const sanitizedDataToUpdate = sanitizeForFirestore(dataToUpdate);

  try {
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists() || docSnap.data().userId !== userId) {
      throw new Error("Permission denied or document not found for update.");
    }
    await updateDoc(docRef, sanitizedDataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string | null): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = { paymentStatus };
 
  if (paymentStatus === 'paid' && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri; // Can be string or null
  } else if (paymentStatus !== 'paid') { 
    updateData.paymentReceiptImageUri = deleteField(); // Remove field if not paid
  }

  try {
     const docSnap = await getDoc(docRef);
     if(!docSnap.exists() || docSnap.data().userId !== userId) {
        throw new Error("Permission denied or document not found for payment status update.");
     }
    await updateDoc(docRef, sanitizeForFirestore(updateData));
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
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

export async function clearDocumentsService(userId: string): Promise<void> {
  await deleteCollectionByUserId(DOCUMENTS_COLLECTION, userId);
}


// --- Price Discrepancy & Product Finalization (mostly for edit-invoice flow) ---
export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
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
    // Ensure unitPrice is a number for comparison, default to 0 if invalid
    const currentProductUnitPrice = typeof product.unitPrice === 'number' ? product.unitPrice : parseFloat(String(product.unitPrice)) || 0;
    // Create a product object with the definitely-numeric unitPrice
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };


    // If product has no ID, or ID indicates it's a temporary/new product from scan, save it directly
    if (!product.id || product.id.startsWith('prod-temp-') || product.id.startsWith('temp-id-') || product.id.includes('-new')) {
      productsToSaveDirectly.push(productWithNumericPrice);
      continue;
    }

    try {
      const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
      const existingProductSnap = await getDoc(existingProductRef);

      if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
        const existingProductData = existingProductSnap.data() as Product;
        // Ensure existingUnitPrice is also a number for comparison
        const existingUnitPrice = typeof existingProductData.unitPrice === 'number' ? existingProductData.unitPrice : parseFloat(String(existingProductData.unitPrice)) || 0;
        
        // Compare with a small tolerance for floating point issues
        if (Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) {
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice);
        }
      } else {
        // Product ID exists but not found for this user in inventory (treat as new or handle as error)
        // For now, let's assume if it's not found for this user but has an ID, it might be an edge case or new product.
        // If it should always exist if it has an ID, this might need different handling.
        productsToSaveDirectly.push(productWithNumericPrice);
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice); // Save directly on error to avoid data loss
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


export async function finalizeSaveProductsService(
    productsFromDocument: Product[], // Products as extracted/edited from the current document
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string, // ID of a "pending" document in Firestore, if this is an update
    // Fields for the Document record
    extractedInvoiceNumber?: string | null,
    finalSupplierName?: string | null,
    extractedTotalAmount?: number | null,
    paymentDueDate?: string | Date | Timestamp | null,
    invoiceDate?: string | Date | Timestamp | null,
    paymentMethod?: string | null,
    originalImagePreviewUriToSave?: string | null,
    compressedImageForFinalRecordUriToSave?: string | null
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[]; // Products as they are in inventory (with final IDs)
}> {
    if (!db) throw new Error("Database not initialized for finalizeSaveProductsService.");
    if (!userId) throw new Error("User authentication is required for finalizeSaveProductsService.");
    console.log(`[Backend - finalizeSaveProductsService] User: ${userId}, DocType: ${documentType}, TempID: ${tempInvoiceId}, Products in Doc: ${productsFromDocument.length}`);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batchOp = writeBatch(db);

    const shouldUpdateInventory = documentType === 'deliveryNote';

    if (shouldUpdateInventory && productsFromDocument.length > 0) {
        console.log("[Backend - finalizeSaveProductsService] Processing products for inventory (deliveryNote)...");
        for (const productFromDoc of productsFromDocument) {
            const quantityFromDoc = parseFloat(String(productFromDoc.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productFromDoc.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productFromDoc.lineTotal)) || 0;

            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductRef;
            let existingProductData: Product | undefined = undefined;
            let foundBy: 'id' | 'catalog' | 'barcode' | 'none' = 'none';

            // Try to find existing product by its own ID (if it's not a temp ID)
            if (productFromDoc.id && !productFromDoc.id.startsWith('prod-temp-') && !productFromDoc.id.startsWith('temp-id-')) {
                const snap = await getDoc(doc(db, INVENTORY_COLLECTION, productFromDoc.id));
                if (snap.exists() && snap.data().userId === userId) {
                    existingProductRef = snap.ref;
                    existingProductData = { id: snap.id, ...snap.data() } as Product;
                    foundBy = 'id';
                }
            }
            // If not found by ID, try by catalog number
            if (!existingProductData && productFromDoc.catalogNumber && productFromDoc.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productFromDoc.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductRef = catSnap.docs[0].ref;
                    existingProductData = { id: catSnap.docs[0].id, ...catSnap.docs[0].data() } as Product;
                    foundBy = 'catalog';
                }
            }
            // If not found by catalog, try by barcode
            if (!existingProductData && productFromDoc.barcode && productFromDoc.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productFromDoc.barcode.trim()), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductRef = barSnap.docs[0].ref;
                    existingProductData = { id: barSnap.docs[0].id, ...barSnap.docs[0].data() } as Product;
                    foundBy = 'barcode';
                }
            }

            if (existingProductRef && existingProductData) {
                console.log(`[Backend - finalizeSaveProductsService] Updating existing product (found by ${foundBy}): ${existingProductData.id}, Current Qty: ${existingProductData.quantity}`);
                const currentInventoryQuantity = Number(existingProductData.quantity) || 0;
                const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
                
                const updatePayload: Partial<Product> = {
                    quantity: updatedQuantity,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : (existingProductData.unitPrice || 0), // Update with new cost price
                    lastUpdated: serverTimestamp(),
                    // Description, shortName, salePrice etc. are only updated if productFromDoc has new explicit values for them
                    // otherwise, we keep the existing values from inventory.
                    ...(productFromDoc.description !== undefined && productFromDoc.description !== existingProductData.description && { description: productFromDoc.description }),
                    ...(productFromDoc.shortName !== undefined && productFromDoc.shortName !== existingProductData.shortName && { shortName: productFromDoc.shortName }),
                    ...(productFromDoc.salePrice !== undefined && productFromDoc.salePrice !== existingProductData.salePrice && { salePrice: productFromDoc.salePrice ?? null }),
                    ...(productFromDoc.minStockLevel !== undefined && productFromDoc.minStockLevel !== existingProductData.minStockLevel && { minStockLevel: productFromDoc.minStockLevel ?? null }),
                    ...(productFromDoc.maxStockLevel !== undefined && productFromDoc.maxStockLevel !== existingProductData.maxStockLevel && { maxStockLevel: productFromDoc.maxStockLevel ?? null }),
                    ...(productFromDoc.barcode !== undefined && productFromDoc.barcode !== existingProductData.barcode && { barcode: productFromDoc.barcode || null }),
                    ...(productFromDoc.imageUrl !== undefined && productFromDoc.imageUrl !== existingProductData.imageUrl && { imageUrl: productFromDoc.imageUrl || null }),
                };
                // Recalculate lineTotal based on new quantity and potentially updated unitPrice
                updatePayload.lineTotal = parseFloat(((updatePayload.quantity || 0) * (updatePayload.unitPrice || 0)).toFixed(2));
                
                batchOp.update(existingProductRef, sanitizeForFirestore(updatePayload));
                savedProductsWithFinalIds.push({ ...existingProductData, ...updatePayload, id: existingProductData.id });
            } else {
                // New product
                if (!productFromDoc.catalogNumber && !productFromDoc.description && !productFromDoc.barcode) {
                    console.warn("[Backend - finalizeSaveProductsService] Skipping new product due to missing identifiers:", productFromDoc);
                    continue;
                }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                console.log(`[Backend - finalizeSaveProductsService] Creating new product: ${productFromDoc.shortName || productFromDoc.description}`);
                const newProductData: Product = { // Ensure all required fields of Product are present
                    id: newProductRef.id, // Firestore will generate ID, but we need it for the return array
                    userId,
                    catalogNumber: productFromDoc.catalogNumber || 'N/A',
                    description: productFromDoc.description || 'No Description',
                    shortName: productFromDoc.shortName || (productFromDoc.description || 'No Description').split(' ').slice(0, 3).join(' '),
                    barcode: (productFromDoc.barcode && productFromDoc.barcode.trim() !== '') ? productFromDoc.barcode.trim() : null,
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc > 0 ? unitPriceFromDoc : 0,
                    salePrice: productFromDoc.salePrice !== undefined ? (Number(productFromDoc.salePrice) ?? null) : null,
                    lineTotal: parseFloat((quantityFromDoc * (unitPriceFromDoc > 0 ? unitPriceFromDoc : 0)).toFixed(2)),
                    minStockLevel: productFromDoc.minStockLevel !== undefined ? (Number(productFromDoc.minStockLevel) ?? null) : null,
                    maxStockLevel: productFromDoc.maxStockLevel !== undefined ? (Number(productFromDoc.maxStockLevel) ?? null) : null,
                    imageUrl: productFromDoc.imageUrl || null,
                    lastUpdated: serverTimestamp(),
                };
                batchOp.set(newProductRef, sanitizeForFirestore(newProductData));
                savedProductsWithFinalIds.push(newProductData);
            }
        }
    } else if (documentType === 'invoice') {
        console.log("[Backend - finalizeSaveProductsService] Tax Invoice: Products not added/updated in inventory.");
        // For tax invoices, sum up line totals from the provided products (if any) to get a calculated total
        // This might be useful if the AI extracted line items but not a grand total.
        productsFromDocument.forEach(p => calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(p.lineTotal)) || 0));
    }

    // Determine the final totalAmount for the document
    const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && extractedTotalAmount !== null && !isNaN(extractedTotalAmount) && extractedTotalAmount > 0)
                                    ? extractedTotalAmount // Use AI extracted grand total if valid
                                    : parseFloat(calculatedInvoiceTotalAmountFromProducts.toFixed(2)); // Fallback to sum of line items

    // Determine the final generated file name
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
    
    let docRef;
    let isNewDocumentCreation = true;
    let existingUploadTimeForUpdate: Timestamp | FieldValue = serverTimestamp();

    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        try {
            const existingDocSnap = await getDoc(docRef);
            if (existingDocSnap.exists()) {
                isNewDocumentCreation = false; 
                existingUploadTimeForUpdate = existingDocSnap.data().uploadTime || serverTimestamp(); // Preserve original uploadTime
                // Preserve image URIs if new ones are not provided (e.g. if user didn't re-upload)
                if (originalImagePreviewUriToSave === undefined && existingDocSnap.data().originalImagePreviewUri) {
                    originalImagePreviewUriToSave = existingDocSnap.data().originalImagePreviewUri;
                }
                if (compressedImageForFinalRecordUriToSave === undefined && existingDocSnap.data().compressedImageForFinalRecordUri) {
                    compressedImageForFinalRecordUriToSave = existingDocSnap.data().compressedImageForFinalRecordUri;
                }
            } else {
                console.warn(`[Backend - finalizeSaveProductsService] Pending document with ID ${tempInvoiceId} not found. Will create a new document with this ID.`);
            }
        } catch (e) { 
            console.error(`Error fetching existing pending document ${tempInvoiceId}:`, e);
            // Fallback to creating a new doc at this ID if fetch fails
        }
    } else if (tempInvoiceId) { // Existing final document ID provided (e.g., editing an already completed invoice)
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        isNewDocumentCreation = false; 
        try {
            const existingDocSnap = await getDoc(docRef);
            if (existingDocSnap.exists() && existingDocSnap.data().userId === userId) {
                existingUploadTimeForUpdate = existingDocSnap.data().uploadTime || serverTimestamp();
                if (originalImagePreviewUriToSave === undefined && existingDocSnap.data().originalImagePreviewUri) {
                    originalImagePreviewUriToSave = existingDocSnap.data().originalImagePreviewUri;
                }
                if (compressedImageForFinalRecordUriToSave === undefined && existingDocSnap.data().compressedImageForFinalRecordUri) {
                    compressedImageForFinalRecordUriToSave = existingDocSnap.data().compressedImageForFinalRecordUri;
                }
            } else {
                throw new Error(`Document with ID ${tempInvoiceId} not found for user ${userId} or permission denied.`);
            }
        } catch (e) { 
            console.error(`Error fetching existing document ${tempInvoiceId} for update:`, e);
            throw e; // Re-throw if we can't find an existing doc we're supposed to update
        }
    } else { 
        // No tempId or existing ID provided, create a brand new document
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
    }

    const convertToTimestampIfValid = (dateVal: any): Timestamp | null => {
        if (!dateVal) return null;
        if (dateVal instanceof Date && isValid(dateVal)) return Timestamp.fromDate(dateVal);
        if (typeof dateVal === 'string' && isValid(parseISO(dateVal))) return Timestamp.fromDate(parseISO(dateVal));
        if (dateVal instanceof Timestamp) return dateVal;
        return null;
    };

    const documentDataForFirestore: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp | FieldValue } = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: isNewDocumentCreation ? serverTimestamp() : existingUploadTimeForUpdate, // Use serverTimestamp for new, preserve for updates
        status: 'completed',
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: !isNaN(finalInvoiceTotalAmount) ? finalInvoiceTotalAmount : null,
        paymentStatus: 'unpaid', // Default for new documents
        paymentDueDate: convertToTimestampIfValid(paymentDueDate),
        invoiceDate: convertToTimestampIfValid(invoiceDate),
        paymentMethod: paymentMethod || null,
        errorMessage: null, // Clear any previous error on successful save
        paymentReceiptImageUri: null, // Default for new documents
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        linkedDeliveryNoteId: null, // Default for new documents
    };
    
    batchOp.set(docRef, sanitizeForFirestore(documentDataForFirestore), { merge: !isNewDocumentCreation });

    let finalUploadTimeForReturn: string;
    if (documentDataForFirestore.uploadTime instanceof Timestamp) {
        finalUploadTimeForReturn = documentDataForFirestore.uploadTime.toDate().toISOString();
    } else {
        // For serverTimestamp(), we can't know the exact time until committed.
        // So, we'll use current client time as a close approximation for the return object.
        // The actual value in Firestore will be the server's timestamp.
        finalUploadTimeForReturn = new Date().toISOString();
    }
    
    const finalInvoiceRecord: InvoiceHistoryItem = { 
        ...(documentDataForFirestore as Omit<InvoiceHistoryItem, 'id' | 'uploadTime' | 'invoiceDate' | 'paymentDueDate'>), // Cast after timestamp conversion
        id: docRef.id, 
        uploadTime: finalUploadTimeForReturn,
        // Ensure date fields in the return object are also ISO strings or null
        invoiceDate: documentDataForFirestore.invoiceDate instanceof Timestamp ? documentDataForFirestore.invoiceDate.toDate().toISOString() : null,
        paymentDueDate: documentDataForFirestore.paymentDueDate instanceof Timestamp ? documentDataForFirestore.paymentDueDate.toDate().toISOString() : null,
    };

    try {
      console.log("[Backend - finalizeSaveProductsService] Committing batch to Firestore...");
      await batchOp.commit();
      console.log("[Backend - finalizeSaveProductsService] Batch commit successful. Final Doc ID:", finalInvoiceRecord.id);
      
      // Clear temporary localStorage data if this was a new scan that used tempInvoiceId (pending record)
      if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        const uniqueScanIdToClear = tempInvoiceId.substring(`pending-inv-${userId}_`.length);
        clearTemporaryScanData(uniqueScanIdToClear, userId);
      }

    } catch (error: any) {
      console.error("[Backend - finalizeSaveProductsService] Error committing batch to Firestore:", error);
      // It's important to re-throw so the calling UI can handle the error (e.g., show a toast)
      throw new Error(`Failed to save document and products to Firestore: ${error.message}`);
    }
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
    const [suppliersSnapshot, documentsSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(documentsQuery)
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const createdAtTimestamp = data.createdAt instanceof Timestamp ? data.createdAt : serverTimestamp();
      const lastActivityDateTimestamp = data.lastActivityDate instanceof Timestamp ? data.lastActivityDate : null;
      
      if (data.name && typeof data.name === 'string') {
        supplierMap.set(data.name, {
          id: docSnap.id,
          userId,
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          paymentTerms: data.paymentTerms || null,
          invoiceCount: 0,
          totalSpent: 0,
          lastActivityDate: lastActivityDateTimestamp,
          createdAt: createdAtTimestamp,
        });
      } else {
        console.warn(`Supplier document ${docSnap.id} for user ${userId} is missing a name or name is not a string.`);
      }
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem; // Assume it fits structure after conversion
      if (docData.supplierName && typeof docData.supplierName === 'string' && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);

        if (!supplierEntry) {
          // If a supplier is found in documents but not in the suppliers collection,
          // we can optionally create a temporary summary for it.
          // For robustness, it's better if suppliers are explicitly created first.
          // However, for display, we can create a placeholder:
          console.warn(`[getSupplierSummariesService] Supplier "${docData.supplierName}" found in documents but not in suppliers collection for user ${userId}. Creating a temporary summary for display.`);
          supplierEntry = {
            id: `doc-derived-${docData.supplierName.replace(/\s+/g, '_')}-${Date.now()}`, // Temporary ID
            userId,
            name: docData.supplierName,
            invoiceCount: 0,
            totalSpent: 0,
            lastActivityDate: null, // Will be updated below
            createdAt: docData.uploadTime instanceof Timestamp ? docData.uploadTime : serverTimestamp(), // Or parseISO if it's string
            phone: null, email: null, paymentTerms: null,
          };
        }
        
        supplierEntry.invoiceCount += 1;
        supplierEntry.totalSpent += (docData.totalAmount || 0);

        let docUploadTime: Date | null = null;
        if (docData.uploadTime) {
            if (docData.uploadTime instanceof Timestamp) docUploadTime = docData.uploadTime.toDate();
            else if (typeof docData.uploadTime === 'string' && isValid(parseISO(docData.uploadTime))) docUploadTime = parseISO(docData.uploadTime);
            // No need to check for Date instance here as getInvoicesService already converts to string
        }
        
        let currentLastActivity: Date | null = null;
        if (supplierEntry.lastActivityDate instanceof Timestamp) {
          currentLastActivity = supplierEntry.lastActivityDate.toDate();
        } else if (typeof supplierEntry.lastActivityDate === 'string' && isValid(parseISO(supplierEntry.lastActivityDate))) {
          currentLastActivity = parseISO(supplierEntry.lastActivityDate);
        }

        if (docUploadTime && (!currentLastActivity || docUploadTime > currentLastActivity)) {
          supplierEntry.lastActivityDate = Timestamp.fromDate(docUploadTime);
        }
        supplierMap.set(docData.supplierName, supplierEntry);
      }
    });
    return Array.from(supplierMap.values()).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  } catch (error) {
    console.error("Error fetching supplier summaries from Firestore:", error);
    throw error;
  }
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized for createSupplierService.");
  if (!userId) throw new Error("User authentication is required for createSupplierService.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error(`Supplier with name "${normalizedName}" already exists.`);

  const newSupplierRef = doc(collection(db, SUPPLIERS_COLLECTION));
  // Constructing the object to be saved, ensuring userId is included
  const newSupplierData: Omit<SupplierSummary, 'id' | 'createdAt' | 'lastActivityDate' | 'invoiceCount' | 'totalSpent'> & { userId: string, createdAt: FieldValue } = {
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null,
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    userId: userId, // Explicitly include userId
    createdAt: serverTimestamp(),
  };
  console.log(`[Backend - createSupplierService] Attempting to save new supplier with data:`, newSupplierData, `for userId: ${userId}`);
  await setDoc(newSupplierRef, sanitizeForFirestore(newSupplierData));

  const now = Timestamp.now(); // For the return object
  return {
      id: newSupplierRef.id,
      userId,
      name: normalizedName,
      phone: newSupplierData.phone,
      email: newSupplierData.email,
      paymentTerms: newSupplierData.paymentTerms,
      invoiceCount: 0, // New supplier has 0 invoices
      totalSpent: 0,   // New supplier has 0 spent
      lastActivityDate: null, // No activity yet
      createdAt: now,  // Or fetch the doc again to get server timestamp if critical
  };
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing for deleteSupplierService.");
  
  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for deletion for supplier ID: ${supplierId}`);
  }
  await deleteDoc(supplierRef);
}

export async function clearSuppliersService(userId: string): Promise<void> {
  await deleteCollectionByUserId(SUPPLIERS_COLLECTION, userId);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string | null; email?: string | null; paymentTerms?: string | null }, userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const existingDoc = await getDoc(supplierRef);
  if (!existingDoc.exists() || existingDoc.data().userId !== userId) {
    throw new Error("Supplier not found or permission denied for update.");
  }

  const updatePayload: Partial<Pick<SupplierSummary, 'phone' | 'email' | 'paymentTerms'>> = {};
  let hasChanges = false;

  // Check and add phone if it's being updated
  if (contactInfo.hasOwnProperty('phone')) {
    const newPhone = contactInfo.phone?.trim() || null;
    if (newPhone !== (existingDoc.data().phone || null)) { // Compare with existing, defaulting to null
        updatePayload.phone = newPhone;
        hasChanges = true;
    }
  }
  // Check and add email if it's being updated
  if (contactInfo.hasOwnProperty('email')) {
    const newEmail = contactInfo.email?.trim() || null;
     if (newEmail !== (existingDoc.data().email || null)) {
        updatePayload.email = newEmail;
        hasChanges = true;
    }
  }
  // Check and add paymentTerms if it's being updated
  if (contactInfo.hasOwnProperty('paymentTerms')) {
    const newPaymentTerms = contactInfo.paymentTerms?.trim() || null;
    if (newPaymentTerms !== (existingDoc.data().paymentTerms || null)) {
        updatePayload.paymentTerms = newPaymentTerms;
        hasChanges = true;
    }
  }
  
  if (hasChanges) {
    await updateDoc(supplierRef, sanitizeForFirestore(updatePayload));
  }
}

// --- User Settings (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("DB not initialized or User ID missing for saveUserSettingsService.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    
    // Create a deep copy to avoid mutating the original settings object if it's from state
    const settingsToSave: Partial<UserSettings> = JSON.parse(JSON.stringify(settings));

    // Sanitize nested objects if they exist or are being explicitly set
    if (settingsToSave.accountantSettings || settings.hasOwnProperty('accountantSettings')) {
        settingsToSave.accountantSettings = sanitizeForFirestore({
            name: settingsToSave.accountantSettings?.name || null,
            email: settingsToSave.accountantSettings?.email || null,
            phone: settingsToSave.accountantSettings?.phone || null,
        });
    }

    if (settingsToSave.posConfig || settings.hasOwnProperty('posConfig')) {
        settingsToSave.posConfig = settingsToSave.posConfig ? sanitizeForFirestore(settingsToSave.posConfig) : {}; // Or null if preferred
    }
    
    if (settingsToSave.kpiPreferences || settings.hasOwnProperty('kpiPreferences')) {
        settingsToSave.kpiPreferences = settingsToSave.kpiPreferences ? sanitizeForFirestore(settingsToSave.kpiPreferences) : { visibleKpiIds: [], kpiOrder: [] };
    }

    if (settingsToSave.quickActionPreferences || settings.hasOwnProperty('quickActionPreferences')) {
        settingsToSave.quickActionPreferences = settingsToSave.quickActionPreferences ? sanitizeForFirestore(settingsToSave.quickActionPreferences) : { visibleQuickActionIds: [], quickActionOrder: [] };
    }

    // Ensure numeric fields or fields that can be null are handled correctly
    if (settingsToSave.monthlyBudget === undefined && settings.hasOwnProperty('monthlyBudget')) {
        settingsToSave.monthlyBudget = null;
    }
    if (settingsToSave.reminderDaysBefore === undefined && settings.hasOwnProperty('reminderDaysBefore')) {
        settingsToSave.reminderDaysBefore = null; // Or a default like 3
    }
    
    // Remove userId explicitly from the object to save, as it's the document ID
    delete (settingsToSave as any).userId; 
    
    console.log("[saveUserSettingsService] Saving settings for user:", userId, settingsToSave);
    await setDoc(userSettingsRef, sanitizeForFirestore(settingsToSave), { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings> {
    const defaultSettings: UserSettings = {
        userId: userId || '', // Ensure userId is part of the default returned object
        reminderDaysBefore: 3, 
        posSystemId: null,
        posConfig: {},
        accountantSettings: { name: null, email: null, phone: null },
        monthlyBudget: null,
        kpiPreferences: { visibleKpiIds: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay'], kpiOrder: ['totalItems', 'inventoryValue', 'grossProfit', 'currentMonthExpenses', 'lowStock', 'amountToPay', 'documentsProcessed30d', 'averageInvoiceValue', 'suppliersCount'] }, // Default visible KPIs
        quickActionPreferences: { visibleQuickActionIds: ['addExpense', 'addProduct', 'openInvoices', 'latestDocument'], quickActionOrder: ['addExpense', 'addProduct', 'openInvoices', 'latestDocument', 'addSupplier'] } // Default visible Quick Actions
    };
    if (!db || !userId) {
      console.warn("getUserSettingsService called without db or userId, returning defaults.");
      return defaultSettings;
    }
    
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        // Merge fetched data with defaults to ensure all fields are present
        return { 
            ...defaultSettings, // Start with defaults
            ...data,            // Override with fetched data
            userId,             // Ensure userId is correctly set
            accountantSettings: data.accountantSettings ? { // Deep merge for nested objects
                name: data.accountantSettings.name || null,
                email: data.accountantSettings.email || null,
                phone: data.accountantSettings.phone || null,
            } : defaultSettings.accountantSettings,
            posConfig: data.posConfig || defaultSettings.posConfig,
            kpiPreferences: data.kpiPreferences || defaultSettings.kpiPreferences,
            quickActionPreferences: data.quickActionPreferences || defaultSettings.quickActionPreferences,
            monthlyBudget: data.monthlyBudget === undefined ? null : (data.monthlyBudget ?? null), // Explicitly handle null/undefined
            reminderDaysBefore: data.reminderDaysBefore === undefined ? defaultSettings.reminderDaysBefore : (data.reminderDaysBefore ?? null),
        };
    }
    console.log(`[getUserSettingsService] No settings found for user ${userId}, returning defaults.`);
    return defaultSettings; // Return defaults if no document exists
}

// --- Other Expenses & Categories (Firestore) ---
// Constants for localStorage keys are no longer needed here for these if fully migrated
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses_FS'; // Suffix to differentiate if needed during transition
export const EXPENSE_CATEGORIES_STORAGE_KEY_BASE = 'invoTrack_expenseCategories_FS';
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates_FS'; // Not yet migrated to Firestore


export async function getOtherExpensesService(userId: string): Promise<OtherExpense[]> {
    if (!db || !userId) {
      console.warn("getOtherExpensesService called without db or userId, returning empty array.");
      return [];
    }
    const expensesQuery = query(collection(db, OTHER_EXPENSES_COLLECTION), where("userId", "==", userId), orderBy("date", "desc"));
    try {
        const snapshot = await getDocs(expensesQuery);
        return snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: docSnap.id, ...data,
                date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date, // Convert to ISO string
            } as OtherExpense;
        });
    } catch (error) {
        console.error("Error fetching other expenses from Firestore:", error);
        if ((error as any).message && (error as any).message.includes("The query requires an index")) {
            console.error("Firestore missing index error for otherExpenses. Check browser console for link to create it.");
        }
        throw error;
    }
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'> & {id?: string}, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveOtherExpenseService.");
  
  const { id: expenseId, ...dataToProcess } = expenseData;

  const dataToSave: any = { 
    ...dataToProcess,
    userId,
    date: typeof dataToProcess.date === 'string' && isValid(parseISO(dataToProcess.date)) 
            ? Timestamp.fromDate(parseISO(dataToProcess.date)) 
            : (dataToProcess.date instanceof Date ? Timestamp.fromDate(dataToProcess.date) 
            : (dataToProcess.date instanceof Timestamp ? dataToProcess.date : serverTimestamp())), // Ensure it's a Timestamp
    _internalCategoryKey: dataToProcess._internalCategoryKey || null, // Ensure null if undefined
    categoryId: dataToProcess.categoryId || null, // Ensure null if undefined
  };

  if (expenseId) { 
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    await updateDoc(docRef, sanitizeForFirestore({ ...dataToSave, lastUpdatedAt: serverTimestamp() }));
    return expenseId;
  } else { 
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION));
    // For new documents, ensure 'id' field is not part of the data object itself.
    const { id, ...actualDataToSave } = dataToSave; 
    await setDoc(newDocRef, sanitizeForFirestore({ ...actualDataToSave, createdAt: serverTimestamp() }));
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

export async function clearOtherExpensesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(OTHER_EXPENSES_COLLECTION, userId);
}


export async function getExpenseCategoriesService(userId: string): Promise<ExpenseCategory[]> {
  if (!db || !userId) {
    console.warn("getExpenseCategoriesService called without db or userId, returning empty array.");
    return [];
  }
  const categoriesQuery = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  try {
    const snapshot = await getDocs(categoriesQuery);
    return snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        ...docSnap.data(), 
        createdAt: docSnap.data().createdAt instanceof Timestamp ? docSnap.data().createdAt : serverTimestamp() 
    } as ExpenseCategory));
  } catch (error) {
     console.error("Error fetching expense categories from Firestore:", error);
     if ((error as any).message && (error as any).message.includes("The query requires an index")) {
        console.error("Firestore missing index error for expenseCategories. Check browser console for link to create it.");
    }
    throw error;
  }
}

export async function saveExpenseCategoryService(categoryData: Omit<ExpenseCategory, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required for saveExpenseCategoryService.");
  if (!categoryData.name || !categoryData.internalKey) throw new Error("Category name and internalKey are required.");

  // Check if category with the same internalKey already exists for this user
  const q = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), where("internalKey", "==", categoryData.internalKey));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Expense category with key "${categoryData.internalKey}" already exists for this user.`);
  }

  const newDocRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
  const dataToSave: Omit<ExpenseCategory, 'id'> = { 
      ...categoryData, 
      userId, 
      createdAt: serverTimestamp(), 
      isFixed: categoryData.isFixed ?? false, // Default to false if not provided
      defaultAmount: categoryData.defaultAmount ?? null, // Default to null
  };
  await setDoc(newDocRef, sanitizeForFirestore(dataToSave));
  return newDocRef.id;
}

export async function clearExpenseCategoriesService(userId: string): Promise<void> {
  await deleteCollectionByUserId(EXPENSE_CATEGORIES_COLLECTION, userId);
}


// Constants for localStorage preferences - these might stay in localStorage for simplicity
export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2_FS';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1_FS';


// --- Temporary Data Management for Uploads (localStorage) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    // console.log(`[clearTemporaryScanData] Attempting to clear keys for UserID: ${userId}, ScanID: ${uniqueScanId}`);
    try {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const originalImageKey = getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      const compressedImageKey = getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${userId}_${uniqueScanId}`);
      
      localStorage.removeItem(dataKey);
      localStorage.removeItem(originalImageKey);
      localStorage.removeItem(compressedImageKey);
      // console.log(`[clearTemporaryScanData] Cleared keys: ${dataKey}, ${originalImageKey}, ${compressedImageKey}`);
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
        
        // If userIdToClear is provided, only target keys for that user
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue; // Skip keys not belonging to the specified user
        }

        // Extract timestamp - assumes format like '..._userId_timestamp_filename'
        const parts = key.split('_');
        // Find the part that is a long number (timestamp)
        const timestampString = parts.find(part => /^\d{13,}$/.test(part)); // 13 digits for ms timestamp
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) { // If emergency, clear all targeted keys
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) { // If not emergency, check expiry
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All Relevant'}).`);
}
