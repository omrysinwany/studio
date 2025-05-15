
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
  unitPrice: number;
  salePrice?: number | null;
  lineTotal: number;
  minStockLevel?: number | null;
  maxStockLevel?: number | null;
  imageUrl?: string | null;
  _originalId?: string;
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
  categoryKey: string; // Should match internalKey of ExpenseCategory
  description: string;
  amount: number;
  createdAt: Timestamp | FieldValue;
}

// --- Storage Keys for localStorage (mostly for UI preferences now) ---
export const KPI_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_kpiPreferences_v2';
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE = 'invoTrack_quickActionsPreferences_v1';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses'; // Define and export this
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings';
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory';
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices';
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';


// --- Storage Keys for temporary data during scan process (localStorage) ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

// --- Storage Limits (localStorage) ---
export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024; // 0.4MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
export const MAX_INVOICE_HISTORY_ITEMS = 20; // Reduced for localStorage if still used for history display


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
    console.warn(`[getStorageKey] Called for base "${baseKey}" without a userId. Using a generic key.`);
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


// --- User Management (Firestore) ---
export async function saveUserToFirestore(userData: User): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userData.id) throw new Error("User ID is missing for saveUserToFirestore.");
  
  const userRef = doc(db, USERS_COLLECTION, userData.id);
  const dataToSave: Partial<User> = { ...userData };
  
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
  if (!db) throw new Error("Firestore (db) is not initialized.");
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
    throw new Error("Firestore (db) is not initialized.");
  }
  if (!userId) {
    console.warn("getProductsService called without userId");
    return [];
  }
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
  try {
    const snapshot = await getDocs(productsQuery);
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Product));
  } catch (error) {
    console.error("Error fetching products from Firestore:", error);
    throw error;
  }
}

export async function getProductByIdService(productId: string, userId: string): Promise<Product | null> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) return null;
  
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
  if (!userId) throw new Error("User authentication is required.");
  
  const productRef = doc(db, INVENTORY_COLLECTION, productId);
  const dataToUpdate: Partial<Product> & { userId: string, lastUpdated: FieldValue } = {
    ...updatedData,
    userId,
    lastUpdated: serverTimestamp()
  };

  (Object.keys(dataToUpdate) as Array<keyof typeof dataToUpdate>).forEach(key => {
    if (dataToUpdate[key] === undefined) {
      (dataToUpdate as any)[key] = null;
    }
  });

  try {
    await updateDoc(productRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating product ${productId} in Firestore:`, error);
    throw error;
  }
}

export async function deleteProductService(productId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  
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
  if (!userId) throw new Error("User authentication is required.");
  
  const productsQuery = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId));
  try {
    const snapshot = await getDocs(productsQuery);
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
    throw new Error("Firestore (db) is not initialized.");
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
        const convertTimestampToString = (field: any) => field instanceof Timestamp ? field.toDate().toISOString() : field;
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
  if (!userId) throw new Error("User authentication is required.");

  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const dataToUpdate: Partial<InvoiceHistoryItem> & { userId: string } = { ...updatedData, userId };

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
  
  const fieldsToNullCheck: (keyof InvoiceHistoryItem)[] = ['supplierName', 'invoiceNumber', 'totalAmount', 'paymentMethod', 'paymentReceiptImageUri', 'originalImagePreviewUri', 'compressedImageForFinalRecordUri', 'errorMessage', 'linkedDeliveryNoteId'];
  fieldsToNullCheck.forEach(field => {
      if (dataToUpdate[field] === undefined) {
          (dataToUpdate as any)[field] = null;
      }
  });

  try {
    await updateDoc(docRef, dataToUpdate);
  } catch (error) {
    console.error(`Error updating document ${invoiceId} in Firestore:`, error);
    throw error;
  }
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  
  const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
  const updateData: any = { paymentStatus, userId };
  if (paymentStatus === 'paid' && paymentReceiptImageUri) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== 'paid') {
    updateData.paymentReceiptImageUri = deleteField();
  }
  try {
    await updateDoc(docRef, updateData);
  } catch (error) {
    console.error(`Error updating payment status for document ${invoiceId}:`, error);
    throw error;
  }
}

export async function deleteInvoiceService(invoiceId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  
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
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication required for price check.");

  const productsToSaveDirectly: Product[] = [];
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];

  for (const product of productsToCheck) {
    const currentProductUnitPrice = typeof product.unitPrice === 'number' ? product.unitPrice : parseFloat(String(product.unitPrice));
    if (isNaN(currentProductUnitPrice)) {
      productsToSaveDirectly.push(product); // If price is invalid, save as is (or handle error)
      continue;
    }
    const productWithNumericPrice = { ...product, unitPrice: currentProductUnitPrice };

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
        if (!isNaN(existingUnitPrice) && Math.abs(existingUnitPrice - productWithNumericPrice.unitPrice) > 0.001 && productWithNumericPrice.unitPrice > 0) { // Only flag if new price is valid
          priceDiscrepancies.push({
            ...productWithNumericPrice,
            existingUnitPrice: existingUnitPrice,
            newUnitPrice: productWithNumericPrice.unitPrice,
          });
        } else {
          productsToSaveDirectly.push(productWithNumericPrice);
        }
      } else {
        productsToSaveDirectly.push(productWithNumericPrice);
      }
    } catch (error) {
      console.error(`Error checking price for product ID ${product.id || product.catalogNumber}:`, error);
      productsToSaveDirectly.push(productWithNumericPrice); // On error, assume no discrepancy or save as is
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
    tempInvoiceId?: string,
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
  uniqueScanIdToClear?: string;
}> {
    if (!db) throw new Error("Database not initialized.");
    if (!userId) throw new Error("User authentication is required.");

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batch = writeBatch(db);
    const uniqueScanIdFromTemp = tempInvoiceId?.startsWith(`pending-inv-${userId}_`)
        ? tempInvoiceId.substring(`pending-inv-${userId}_`.length)
        : (tempInvoiceId ? tempInvoiceId.replace(`${userId}_`, '') : null);

    const shouldUpdateInventory = documentType === 'deliveryNote';

    if (shouldUpdateInventory && productsToFinalizeSave.length > 0) {
        for (const productToSave of productsToFinalizeSave) {
            const quantityFromDoc = parseFloat(String(productToSave.quantity)) || 0;
            let unitPriceFromDoc = parseFloat(String(productToSave.unitPrice)) || 0;
            const lineTotalFromDoc = parseFloat(String(productToSave.lineTotal)) || 0;

            if (unitPriceFromDoc === 0 && quantityFromDoc !== 0 && lineTotalFromDoc !== 0 && (lineTotalFromDoc / quantityFromDoc > 0)) {
                unitPriceFromDoc = parseFloat((lineTotalFromDoc / quantityFromDoc).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotalFromDoc;

            let existingProductSnap;
            let existingProductRef;

            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productToSave.id);
                existingProductSnap = await getDoc(existingProductRef);
                if (!existingProductSnap.exists() || existingProductSnap.data().userId !== userId) existingProductSnap = undefined;
            }
            if (!existingProductSnap && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productToSave.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) { existingProductSnap = catSnap.docs[0]; existingProductRef = existingProductSnap.ref; }
            }
            if (!existingProductSnap && productToSave.barcode && productToSave.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productToSave.barcode), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) { existingProductSnap = barSnap.docs[0]; existingProductRef = existingProductSnap.ref; }
            }

            const productDataForFirestore: Partial<Omit<Product, 'id' | 'quantity' | 'unitPrice' | 'lineTotal'>> & { userId: string, lastUpdated: FieldValue } = {
                userId,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                barcode: (productToSave.barcode && productToSave.barcode.trim() !== '') ? productToSave.barcode.trim() : null,
                lastUpdated: serverTimestamp(),
                salePrice: productToSave.salePrice !== undefined && !isNaN(Number(productToSave.salePrice)) ? Number(productToSave.salePrice) : null,
                minStockLevel: productToSave.minStockLevel !== undefined && !isNaN(Number(productToSave.minStockLevel)) ? Number(productToSave.minStockLevel) : null,
                maxStockLevel: productToSave.maxStockLevel !== undefined && !isNaN(Number(productToSave.maxStockLevel)) ? Number(productToSave.maxStockLevel) : null,
                imageUrl: productToSave.imageUrl || null,
            };

            if (existingProductSnap && existingProductSnap.exists() && existingProductRef) {
                const existingData = existingProductSnap.data() as Product;
                const currentInventoryQuantity = Number(existingData.quantity) || 0;
                const updatedQuantity = currentInventoryQuantity + quantityFromDoc;
                const finalUnitPrice = (unitPriceFromDoc > 0) ? unitPriceFromDoc : (existingData.unitPrice || 0);

                const updatePayload: Partial<Product> = {
                    ...productDataForFirestore,
                    quantity: updatedQuantity,
                    unitPrice: finalUnitPrice,
                    lineTotal: parseFloat(((updatedQuantity || 0) * finalUnitPrice).toFixed(2)),
                };
                batch.update(existingProductRef, updatePayload);
                savedProductsWithFinalIds.push({ ...existingData, ...updatePayload, id: existingProductRef.id });
            } else {
                 if (!productDataForFirestore.catalogNumber && !productDataForFirestore.description && !productDataForFirestore.barcode) {
                    console.warn("Skipping product save as it lacks key identifiers (catalog, desc, barcode):", productDataForFirestore);
                    continue;
                 }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                const newProductData: Product = {
                    id: newProductRef.id, 
                    ...(productDataForFirestore as Omit<Product, 'id' | 'userId' | 'quantity' | 'unitPrice' | 'lineTotal'>), // Type assertion
                    userId,
                    quantity: quantityFromDoc,
                    unitPrice: unitPriceFromDoc,
                    lineTotal: parseFloat((quantityFromDoc * unitPriceFromDoc).toFixed(2)),
                };
                batch.set(newProductRef, newProductData);
                savedProductsWithFinalIds.push({ ...newProductData });
            }
        }
    } else if (documentType === 'invoice' && productsToFinalizeSave.length > 0) { // If it's a tax invoice, sum its line items if provided
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
    finalGeneratedFileName = finalGeneratedFileName.replace(/[/\\?%*:|"<>]/g, '-').substring(0,100);
    const currentUploadTime = Timestamp.now();

    const documentData: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { uploadTime: Timestamp } = {
        userId,
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload,
        uploadTime: currentUploadTime,
        status: finalStatus,
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber || null,
        supplierName: finalSupplierName || null,
        totalAmount: finalInvoiceTotalAmount,
        originalImagePreviewUri: originalImagePreviewUriToSave || null,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave || null,
        paymentStatus: 'unpaid',
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' && isValid(parseISO(paymentDueDate)) ? Timestamp.fromDate(parseISO(paymentDueDate)) : (paymentDueDate instanceof Timestamp ? paymentDueDate : null)),
        invoiceDate: invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' && isValid(parseISO(invoiceDate)) ? Timestamp.fromDate(parseISO(invoiceDate)) : (invoiceDate instanceof Timestamp ? invoiceDate : null)),
        paymentMethod: paymentMethod || null,
        errorMessage: null,
        paymentReceiptImageUri: null,
        linkedDeliveryNoteId: null,
    };

    let docRef;
    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        batch.set(docRef, documentData, { merge: true });
    } else if (tempInvoiceId) { // Existing document being fully updated
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        batch.update(docRef, documentData); // Use update if it's an existing doc not from pending flow
    } else { // Completely new document, not from pending flow
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        batch.set(docRef, documentData);
    }
    finalInvoiceRecord = { ...documentData, id: docRef.id, uploadTime: documentData.uploadTime.toDate().toISOString() };

    try {
      await batch.commit();
      if (uniqueScanIdFromTemp) {
        clearTemporaryScanData(uniqueScanIdFromTemp, userId);
      }
    } catch (error: any) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      const saveError = new Error(`Failed to save to Firestore: ${error.message}`);
      (saveError as any).uniqueScanIdToClear = uniqueScanIdFromTemp; // Pass this back for cleanup
      throw saveError;
    }
    return { finalInvoiceRecord, savedProductsWithFinalIds, uniqueScanIdToClear: undefined };
}


// --- Supplier Management (Firestore) ---
export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) throw new Error("Firestore (db) is not initialized.");
  if (!userId) return [];

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
        id: docSnap.id, userId, name: data.name,
        phone: data.phone || null, email: data.email || null, paymentTerms: data.paymentTerms || null,
        invoiceCount: 0, totalSpent: 0,
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : (typeof data.lastActivityDate === 'string' ? data.lastActivityDate : null),
        createdAt: data.createdAt, // Keep as Timestamp or FieldValue for Firestore
      });
    });

    documentsSnapshot.docs.forEach(docSnap => {
      const docData = docSnap.data() as InvoiceHistoryItem;
      if (docData.supplierName && docData.status === 'completed') {
        let supplierEntry = supplierMap.get(docData.supplierName);
        if (!supplierEntry) {
           supplierEntry = {
                id: `temp-${docData.supplierName.replace(/\s+/g, '_')}-${Date.now()}`, userId,
                name: docData.supplierName, invoiceCount: 0, totalSpent: 0,
                lastActivityDate: null, createdAt: serverTimestamp(), // For new implicit suppliers
           };
           // Do not add to map here if we only want to show explicitly created suppliers in the main list.
           // Or, if we want to include them: supplierMap.set(docData.supplierName, supplierEntry);
        } else { // Only update if supplierEntry was found in the map
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
  if (!userId) throw new Error("User authentication is required.");
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) throw new Error(`Supplier with name "${normalizedName}" already exists.`);

  const newSupplierData = {
    userId, name: normalizedName,
    phone: contactInfo.phone?.trim() || null, email: contactInfo.email?.trim() || null, paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0, totalSpent: 0, lastActivityDate: null, createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), newSupplierData);
  return { ...newSupplierData, id: docRef.id, createdAt: Timestamp.now() } as SupplierSummary;
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  
  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for deletion.`);
  }
  await deleteDoc(supplierRef);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string; email?: string; paymentTerms?: string }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  const supplierRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  const supplierDoc = await getDoc(supplierRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error(`Supplier not found or permission denied for update.`);
  }

  const updateData: any = { userId }; // Ensure userId is part of the update if needed by rules
  let hasChanges = false;
  if (contactInfo.phone !== undefined) { updateData.phone = contactInfo.phone.trim() || null; hasChanges = true; }
  if (contactInfo.email !== undefined) { updateData.email = contactInfo.email.trim() || null; hasChanges = true; }
  if (contactInfo.paymentTerms !== undefined) { updateData.paymentTerms = contactInfo.paymentTerms.trim() || null; hasChanges = true; }

  if (hasChanges) await updateDoc(supplierRef, updateData);
}


// --- Settings Management (Firestore) ---
export async function saveUserSettingsService(settings: Partial<Omit<UserSettings, 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId); // Document ID is the userId
    await setDoc(userSettingsRef, { ...settings, userId }, { merge: true });
}

export async function getUserSettingsService(userId: string): Promise<UserSettings | null> {
    if (!db || !userId) return null;
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    const docSnap = await getDoc(userSettingsRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        // Firestore Timestamps in nested objects are not automatically converted by default
        const convertNestedTimestamps = (obj: any): any => {
            if (!obj) return obj;
            Object.keys(obj).forEach(key => {
                if (obj[key] instanceof Timestamp) {
                    obj[key] = obj[key].toDate().toISOString();
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    convertNestedTimestamps(obj[key]);
                }
            });
            return obj;
        };
        return { userId, ...convertNestedTimestamps(data) } as UserSettings;
    }
    // Return default settings if none exist, ensuring userId is included
    return {
        userId,
        reminderDaysBefore: 3, // Default example
        posSystemId: null,
        posConfig: {},
        accountantSettings: {},
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
            date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date, // Convert Timestamp to ISO string
        } as OtherExpense;
    });
}

export async function saveOtherExpenseService(expenseData: Omit<OtherExpense, 'id' | 'userId'>, userId: string): Promise<string> {
    if (!db || !userId) throw new Error("User authentication required.");
    const newDocRef = doc(collection(db, OTHER_EXPENSES_COLLECTION)); // Auto-generate ID
    await setDoc(newDocRef, {
        ...expenseData,
        userId,
        date: typeof expenseData.date === 'string' && isValid(parseISO(expenseData.date)) ? Timestamp.fromDate(parseISO(expenseData.date)) : (expenseData.date instanceof Date ? Timestamp.fromDate(expenseData.date) : expenseData.date),
        createdAt: serverTimestamp(),
        id: newDocRef.id // Store the auto-generated ID within the document
    });
    return newDocRef.id;
}

export async function updateOtherExpenseService(expenseId: string, expenseData: Partial<Omit<OtherExpense, 'id' | 'userId'>>, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const dataToUpdate: any = { ...expenseData, userId }; // Ensure userId for security rules
    if (expenseData.date && typeof expenseData.date === 'string' && isValid(parseISO(expenseData.date))) {
        dataToUpdate.date = Timestamp.fromDate(parseISO(expenseData.date));
    } else if (expenseData.date instanceof Date) {
        dataToUpdate.date = Timestamp.fromDate(expenseData.date);
    }
    await updateDoc(docRef, dataToUpdate);
}

export async function deleteOtherExpenseService(expenseId: string, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication required.");
    const docRef = doc(db, OTHER_EXPENSES_COLLECTION, expenseId);
    const docSnap = await getDoc(docRef); // Check ownership before deleting
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
  if (!db || !userId) throw new Error("User authentication required.");
  if (!categoryData.name || !categoryData.internalKey) throw new Error("Category name and internalKey are required.");

  // Check if category with the same internalKey already exists for this user
  const q = query(collection(db, EXPENSE_CATEGORIES_COLLECTION), where("userId", "==", userId), where("internalKey", "==", categoryData.internalKey));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Expense category with key "${categoryData.internalKey}" already exists for this user.`);
  }

  const newDocRef = doc(collection(db, EXPENSE_CATEGORIES_COLLECTION));
  await setDoc(newDocRef, { ...categoryData, userId, createdAt: serverTimestamp(), id: newDocRef.id });
  return newDocRef.id;
}

export async function getExpenseTemplatesService(userId: string): Promise<ExpenseTemplate[]> {
  if (!db || !userId) return [];
  const templatesQuery = query(collection(db, EXPENSE_TEMPLATES_COLLECTION), where("userId", "==", userId), orderBy("name"));
  const snapshot = await getDocs(templatesQuery);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ExpenseTemplate));
}

export async function saveExpenseTemplateService(templateData: Omit<ExpenseTemplate, 'id' | 'userId' | 'createdAt'>, userId: string): Promise<string> {
  if (!db || !userId) throw new Error("User authentication required.");
  const newDocRef = doc(collection(db, EXPENSE_TEMPLATES_COLLECTION));
  await setDoc(newDocRef, { ...templateData, userId, createdAt: serverTimestamp(), id: newDocRef.id });
  return newDocRef.id;
}


// --- Temporary Data Management for Uploads (localStorage) ---
export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
    if (typeof window === 'undefined' || !userId) return;
    if (!uniqueScanId) {
      console.warn("[clearTemporaryScanData] Called without uniqueScanId for user:", userId);
      return;
    }
    try {
      localStorage.removeItem(getStorageKey(TEMP_DATA_KEY_PREFIX, `${userId}_${uniqueScanId}`));
      localStorage.removeItem(getStorageKey(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, `${userId}_${uniqueScanId}`));
      localStorage.removeItem(getStorageKey(TEMP_COMPRESSED_IMAGE_KEY_PREFIX, `${userId}_${uniqueScanId}`));
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
        // If userIdToClear is provided, only target keys for that user.
        // Otherwise (if userIdToClear is undefined), target keys for any user (potentially for a general cleanup task, less common).
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
            continue; // Skip keys not belonging to the specified user
        }

        const parts = key.split('_'); // e.g., invoTrackTempScan_USERID_TIMESTAMP_FILENAME
        // A more robust way to find the timestamp, assuming it's the part that's a 13-digit number
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) { // In emergency, clear targeted user's temp data or all if no user specified
             keysToRemove.push(key);
        } else if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          // Clear if it's an old item (older than EXPIRY_DURATION_MS)
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All Relevant'}).`);
}
