
// src/services/backend.ts
'use client';

import { db, auth } from '@/lib/firebase'; // Ensure auth is also exported if needed for userId
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
  addDoc, // For creating new documents with auto-generated IDs
  FieldValue
} from "firebase/firestore";
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

// Firestore Collection Names
const USERS_COLLECTION = "users";
const INVENTORY_COLLECTION = "inventoryProducts";
const DOCUMENTS_COLLECTION = "documents";
const SUPPLIERS_COLLECTION = "suppliers";
const OTHER_EXPENSES_COLLECTION = "otherExpenses";
const EXPENSE_CATEGORIES_COLLECTION = "expenseCategories"; // Assuming you might want this
const EXPENSE_TEMPLATES_COLLECTION = "expenseTemplates"; // Assuming you might want this
const USER_SETTINGS_COLLECTION = "userSettings";


export interface User {
  id: string;
  username?: string;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string; // Firestore document ID
  userId?: string; // Added for Firestore security rules
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
  _originalId?: string; // Used during import/scan if needed
  lastUpdated?: Timestamp | FieldValue;
}

export interface InvoiceHistoryItem { // Consider renaming to Document
  id: string; // Firestore document ID
  userId: string;
  originalFileName: string;
  generatedFileName: string;
  uploadTime: string | Timestamp; // ISO string or Firestore Timestamp for consistency
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt'; // Added 'paymentReceipt'
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string | Timestamp;
  totalAmount?: number;
  paymentMethod?: string;
  paymentDueDate?: string | Timestamp;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string;
  originalImagePreviewUri?: string;
  compressedImageForFinalRecordUri?: string;
  errorMessage?: string;
  linkedDeliveryNoteId?: string;
  // products field removed, use DocumentLineItems subcollection or separate collection
}

export interface DocumentLineItem {
  // id: string; // Firestore can auto-generate this if it's a subcollection
  documentId?: string; // Link to the parent document
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
  id: string; // Firestore document ID
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
  reminderDaysBefore?: number;
  posSystemId?: string;
  posConfig?: PosConnectionConfig;
  accountantSettings?: AccountantSettings;
  monthlyBudget?: number;
  kpiPreferences?: { visibleKpiIds: string[], kpiOrder: string[] };
  quickActionPreferences?: { visibleQuickActionIds: string[], quickActionOrder: string[] };
}

export interface OtherExpense {
  id: string; // Firestore document ID
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  category: string; // Could be categoryId if using a separate collection
  _internalCategoryKey?: string;
}

export interface ExpenseTemplate {
  id: string; // Firestore document ID
  userId: string;
  name: string;
  category: string; // Could be categoryId
  description: string;
  amount: number;
}


// --- Storage Keys for localStorage (primarily for temporary data now) ---
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses'; // Will migrate if needed
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates'; // Will migrate if needed
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget'; // Will migrate if needed
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory'; // Keep for possible quick-access cache or if migration is partial
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices'; // Keep for similar reasons as inventory


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024;
export const MAX_INVOICE_HISTORY_ITEMS = 100; // Firestore can handle more, this is for localStorage limits


export interface StoredPosSettings {
    systemId: string;
    config: PosConnectionConfig;
}

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

// This function should now ideally only be used for settings or non-critical UI state
// that doesn't warrant Firestore yet, or for temporary data.
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

// This function also needs to be used judiciously.
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
        clearOldTemporaryScanData(true, userId); // Pass userId to clear only for this user
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`Successfully saved to localStorage after cleanup for key ${storageKey}`);
        return true;
      } catch (retryError) {
        console.error(`Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        throw retryError; // Re-throw critical error
      }
    } else {
      throw error; // Re-throw other critical errors
    }
  }
  return false; // Should not be reached if errors are thrown
};

// --- User Management with Firestore ---
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
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
      } as User;
    }
    return null;
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}

// --- Product & Inventory Management with Firestore ---
export async function getProductsService(userId: string): Promise<Product[]> {
  if (!db) throw new Error("Database not initialized.");
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
  if (!db) throw new Error("Database not initialized.");
  if (!userId) return null;
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
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
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    // Optional: verify ownership before update if not handled by security rules
    // const currentProduct = await getDoc(productRef);
    // if (!currentProduct.exists() || currentProduct.data().userId !== userId) {
    //   throw new Error("Unauthorized: Cannot update product not owned by user.");
    // }
    await updateDoc(productRef, { ...updatedData, userId, lastUpdated: serverTimestamp() });
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    // Optional: verify ownership
    await deleteDoc(productRef);
  } catch (error) {
    console.error(`Error deleting product ${productId} from Firestore:`, error);
    throw error;
  }
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
    const snapshot = await getDocs(productsQuery);
    const batch = writeBatch(db);
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (error) {
    console.error("Error clearing inventory from Firestore:", error);
    throw error;
  }
}

// --- Document (InvoiceHistoryItem) Management with Firestore ---
export async function getInvoicesService(userId: string): Promise<InvoiceHistoryItem[]> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) {
    console.warn("getInvoicesService called without userId. Returning empty array.");
    return [];
  }
  try {
    const documentsQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), orderBy("uploadTime", "desc"));
    const snapshot = await getDocs(documentsQuery);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InvoiceHistoryItem));
  } catch (error) {
    console.error("Error fetching documents from Firestore:", error);
    throw error;
  }
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
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
      updateData.paymentReceiptImageUri = undefined; // Or deleteField() if you prefer
    }
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error(`Error deleting document ${invoiceId} from Firestore:`, error);
    throw error;
  }
}

// --- Main Service Logic for Saving Products & Invoice History to Firestore ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string, // This is the ID from the 'pending' record if it exists
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string | Date,
    invoiceDate?: string | Date,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string,
    compressedImageForFinalRecordUriToSave?: string
): Promise<{
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {
    if (!db) throw new Error("Database not initialized.");
    if (!userId) {
      throw new Error("User authentication is required to save products and invoice history.");
    }

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;

    const batch = writeBatch(db);

    // Process products for inventory
    if (documentType === 'deliveryNote' || (documentType === 'invoice' && tempInvoiceId?.includes('_sync'))) {
        for (const productToSave of productsToFinalizeSave) {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (quantityToAdd !== 0 && lineTotal !== 0 && unitPrice === 0 && lineTotal/quantityToAdd > 0) {
                unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotal;

            // Try to find existing product
            let existingProductSnap;
            let existingProductRef;

            // Prioritize ID if it's a Firestore ID
            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productToSave.id);
                existingProductSnap = await getDoc(existingProductRef);
                if (existingProductSnap.exists() && existingProductSnap.data().userId !== userId) {
                  existingProductSnap = undefined; // Not the user's product
                }
            }
            // Then by catalogNumber
            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productToSave.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductSnap = catSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                }
            }
            // Then by barcode
            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.barcode && productToSave.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productToSave.barcode), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductSnap = barSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                }
            }

            const productData: Omit<Product, 'id'> = {
                userId,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                barcode: productToSave.barcode === null ? undefined : (productToSave.barcode ?? undefined),
                quantity: quantityToAdd,
                unitPrice: (unitPrice && unitPrice > 0) ? unitPrice : (existingProductSnap?.data().unitPrice || 0),
                salePrice: salePrice ?? existingProductSnap?.data().salePrice,
                minStockLevel: productToSave.minStockLevel ?? existingProductSnap?.data().minStockLevel,
                maxStockLevel: productToSave.maxStockLevel ?? existingProductSnap?.data().maxStockLevel,
                imageUrl: productToSave.imageUrl === null ? undefined : (productToSave.imageUrl ?? existingProductSnap?.data().imageUrl),
                lineTotal: 0, // Will be recalculated
                lastUpdated: serverTimestamp()
            };
            productData.lineTotal = parseFloat(((productData.quantity || 0) * (productData.unitPrice || 0)).toFixed(2));


            if (existingProductSnap && existingProductSnap.exists() && existingProductRef) {
                const existingData = existingProductSnap.data() as Product;
                const updatedQuantity = (documentType === 'deliveryNote')
                    ? (existingData.quantity || 0) + quantityToAdd
                    : quantityToAdd; // For sync/invoice, overwrite/set quantity

                batch.update(existingProductRef, {
                    ...productData,
                    quantity: updatedQuantity,
                    lineTotal: parseFloat(((updatedQuantity || 0) * (productData.unitPrice || 0)).toFixed(2)),
                });
                savedProductsWithFinalIds.push({ ...productData, id: existingProductRef.id, quantity: updatedQuantity });
            } else {
                if (!productData.catalogNumber && !productData.description && !productData.barcode) continue;
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION)); // Auto-generate ID
                batch.set(newProductRef, productData);
                savedProductsWithFinalIds.push({ ...productData, id: newProductRef.id });
            }
        }
    } else {
        productsToFinalizeSave.forEach(productToSave => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productToSave.lineTotal)) || 0);
        });
    }

    // Process document (InvoiceHistoryItem)
    let finalInvoiceRecord: InvoiceHistoryItem | undefined = undefined;
    const finalStatus: InvoiceHistoryItem['status'] = 'completed';
    const finalInvoiceTotalAmount = (extractedTotalAmount !== undefined && !isNaN(extractedTotalAmount))
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

    const currentUploadTime = new Date().toISOString();

    const documentData: Omit<InvoiceHistoryItem, 'id'> = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: currentUploadTime, // Use consistent ISO string
        status: finalStatus,
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || undefined,
        supplierName: finalSupplierName || undefined,
        totalAmount: finalInvoiceTotalAmount,
        originalImagePreviewUri: originalImagePreviewUriToSave,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave,
        paymentStatus: 'unpaid', // Default
        paymentDueDate: paymentDueDate instanceof Date ? paymentDueDate.toISOString() : paymentDueDate,
        invoiceDate: invoiceDate instanceof Date ? invoiceDate.toISOString() : invoiceDate,
        paymentMethod: paymentMethod || undefined,
        errorMessage: undefined, // Assuming success at this stage if no error was caught before
    };

    let docRef;
    if (tempInvoiceId && tempInvoiceId.startsWith('pending-inv-')) {
        // This ID was likely created client-side, if we want to use it, fine.
        // Otherwise, it's better to let Firestore generate IDs for new docs.
        // For simplicity if tempId exists and it's a "pending" one, we can assume
        // it's a placeholder and we'll create a new Firestore document.
        // OR, if `tempInvoiceId` is meant to be the *actual* Firestore ID of a pending doc,
        // we should use `doc(db, DOCUMENTS_COLLECTION, tempInvoiceId.replace(`pending-inv-${userId}_`, ''))`
        // For now, let's assume `tempInvoiceId` is not a Firestore ID and create new.
        docRef = doc(collection(db, DOCUMENTS_COLLECTION)); // New Firestore ID
    } else if (tempInvoiceId) { // If tempInvoiceId IS a Firestore ID (e.g. from POS sync)
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
    }
    else {
        docRef = doc(collection(db, DOCUMENTS_COLLECTION)); // New Firestore ID
    }

    batch.set(docRef, documentData); // Use set to create or overwrite
    finalInvoiceRecord = { ...documentData, id: docRef.id };


    try {
      await batch.commit();
    } catch (error) {
      console.error("Error committing batch to Firestore:", error);
      throw error;
    }

    return { finalInvoiceRecord, savedProductsWithFinalIds };
}


// --- Supplier Management with Firestore ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) return [];

  const suppliersQuery = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId));
  const invoicesQuery = query(collection(db, DOCUMENTS_COLLECTION), where("userId", "==", userId), where("status", "==", "completed"));

  try {
    const [suppliersSnapshot, invoicesSnapshot] = await Promise.all([
      getDocs(suppliersQuery),
      getDocs(invoicesQuery)
    ]);

    const supplierMap = new Map<string, SupplierSummary>();

    suppliersSnapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      supplierMap.set(docSnap.id, {
        id: docSnap.id,
        userId,
        name: data.name,
        phone: data.phone,
        email: data.email,
        paymentTerms: data.paymentTerms,
        invoiceCount: 0,
        totalSpent: 0,
        lastActivityDate: data.lastActivityDate, // Keep as Firestore Timestamp or convert
        createdAt: data.createdAt,
      });
    });

    invoicesSnapshot.docs.forEach(docSnap => {
      const invoice = docSnap.data() as InvoiceHistoryItem;
      if (invoice.supplierName) {
        // Find supplier by name - might need to adjust if IDs are used
        let supplierEntry = Array.from(supplierMap.values()).find(s => s.name === invoice.supplierName);
        if (supplierEntry) {
          supplierEntry.invoiceCount += 1;
          supplierEntry.totalSpent += (invoice.totalAmount || 0);
          const invoiceUploadTime = invoice.uploadTime ? (typeof invoice.uploadTime === 'string' ? parseISO(invoice.uploadTime) : (invoice.uploadTime as Timestamp).toDate()) : null;
          if (invoiceUploadTime) {
            const currentLastActivity = supplierEntry.lastActivityDate ? (typeof supplierEntry.lastActivityDate === 'string' ? parseISO(supplierEntry.lastActivityDate) : (supplierEntry.lastActivityDate as Timestamp).toDate()) : null;
            if (!currentLastActivity || invoiceUploadTime > currentLastActivity) {
              supplierEntry.lastActivityDate = Timestamp.fromDate(invoiceUploadTime); // Store as Timestamp
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

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<SupplierSummary> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", name));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Supplier with name "${name}" already exists for this user.`);
  }

  const newSupplierData = {
    userId,
    name,
    phone: contactInfo.phone || null,
    email: contactInfo.email || null,
    paymentTerms: contactInfo.paymentTerms || null,
    invoiceCount: 0,
    totalSpent: 0,
    lastActivityDate: null,
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), newSupplierData);
  return { ...newSupplierData, id: docRef.id, createdAt: Timestamp.now() } as SupplierSummary; // Approximate createdAt
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  // Add check to ensure user owns this supplier before deleting based on security rules
  const docRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  await deleteDoc(docRef);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  const docRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const updateData: any = {};
  if (contactInfo.phone !== undefined) updateData.phone = contactInfo.phone;
  if (contactInfo.email !== undefined) updateData.email = contactInfo.email;
  if (contactInfo.paymentTerms !== undefined) updateData.paymentTerms = contactInfo.paymentTerms;

  if (Object.keys(updateData).length > 0) {
    updateData.userId = userId; // Ensure userId is part of update for rules
    await updateDoc(docRef, updateData);
  }
}


// --- Settings Management (Still good for localStorage if they are client-side prefs) ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { posSystemId: systemId, posConfig: config, userId }, { merge: true });
}

export async function getPosSettingsService(userId?: string): Promise<StoredPosSettings | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists() && docSnap.data().posSystemId) {
    const data = docSnap.data();
    return { systemId: data.posSystemId, config: data.posConfig || {} };
  }
  return null;
}

export async function clearPosSettingsService(userId?: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await updateDoc(userSettingsRef, {
        posSystemId: null, // Or deleteField()
        posConfig: null    // Or deleteField()
    });
}

export async function saveAccountantSettingsService(settings: AccountantSettings, userId?: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { accountantSettings: settings, userId }, { merge: true });
}

export async function getAccountantSettingsService(userId?: string): Promise<AccountantSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        return docSnap.data().accountantSettings || null;
    }
    return null;
}

export async function saveUserSettingsService(settings: Partial<UserSettings>, userId: string): Promise<void> {
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
    return { userId }; // Return default if no settings doc exists yet
}

// --- Temporary Data (still using localStorage for this specific flow) ---
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
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) continue; // Skip if clearing for specific user and key doesn't match
        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part)); // Find a part that is a 13+ digit number (timestamp)
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        } else if (!timestamp && emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) { // If no timestamp found and it's an emergency clear for a specific user or not a shared key
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All'}).`);
}

// Generic function to get a single object, useful for settings that are one doc per user
async function getStoredObject<T>(collectionName: string, userId: string): Promise<T | null> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) return null;
  try {
    const docRef = doc(db, collectionName, userId); // Assumes document ID is the userId
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as T;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching object from ${collectionName} for user ${userId}:`, error);
    throw error;
  }
}
