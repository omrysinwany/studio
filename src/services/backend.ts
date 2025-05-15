
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
  FieldValue
} from "firebase/firestore";
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

// Firestore Collection Names
const USERS_COLLECTION = "users";
const INVENTORY_COLLECTION = "inventoryProducts";
const DOCUMENTS_COLLECTION = "documents";
const SUPPLIERS_COLLECTION = "suppliers";
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
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  category: string;
  _internalCategoryKey?: string;
}

export interface ExpenseTemplate {
  id: string;
  userId: string;
  name: string;
  category: string;
  description: string;
  amount: number;
}

// Storage Keys for localStorage (temporary data, settings not yet in Firestore)
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';

// --- Storage Keys for temporary data ---
export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024; // 0.4MB
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
export const MAX_INVOICE_HISTORY_ITEMS = 50; // Reduced for localStorage


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
        throw retryError;
      }
    } else {
      throw error;
    }
  }
  return false;
};

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
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot update product.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const productRef = doc(db, INVENTORY_COLLECTION, productId);
    await updateDoc(productRef, { ...updatedData, userId, lastUpdated: serverTimestamp() });
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
    await updateDoc(docRef, { ...updatedData, userId });
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
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot delete document.");
    throw new Error("Database not initialized.");
  }
  if (!userId) throw new Error("User authentication is required.");
  try {
    const docRef = doc(db, DOCUMENTS_COLLECTION, invoiceId);
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
    if (!product.id || product.id.startsWith('prod-temp-') || product.id.includes('-new')) {
      // This product is considered new or temporary, no existing price to check against in this specific check
      // It might be checked against catalog/barcode later in finalizeSaveProductsService for merging
      productsToSaveDirectly.push(product);
      continue;
    }

    const existingProductRef = doc(db, INVENTORY_COLLECTION, product.id);
    const existingProductSnap = await getDoc(existingProductRef);

    if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
      const existingProductData = existingProductSnap.data() as Product;
      if (existingProductData.unitPrice !== undefined && product.unitPrice !== undefined &&
          Math.abs(existingProductData.unitPrice - product.unitPrice) > 0.001) { // Allow small floating point differences
        priceDiscrepancies.push({
          ...product,
          existingUnitPrice: existingProductData.unitPrice,
          newUnitPrice: product.unitPrice,
        });
      } else {
        productsToSaveDirectly.push(product);
      }
    } else {
      // Product not found or doesn't belong to user, treat as new for this check
      productsToSaveDirectly.push(product);
    }
  }
  return { productsToSaveDirectly, priceDiscrepancies };
}


export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId: string,
    tempInvoiceId?: string,
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
    if (!db) {
      console.error("Firestore (db) is not initialized. Cannot finalize save.");
      throw new Error("Database not initialized.");
    }
    if (!userId) {
      console.error("User ID is missing. Cannot finalize save.");
      throw new Error("User authentication is required to save products and invoice history.");
    }
    console.log("[finalizeSaveProductsService] Starting. UserID:", userId, "DocumentType:", documentType, "TempInvoiceID:", tempInvoiceId);

    const savedProductsWithFinalIds: Product[] = [];
    let calculatedInvoiceTotalAmountFromProducts = 0;
    const batchOp = writeBatch(db);

    if (documentType === 'deliveryNote' || (documentType === 'invoice' && tempInvoiceId?.includes('_sync'))) {
        console.log(`[finalizeSaveProductsService] Processing ${productsToFinalizeSave.length} products for inventory.`);
        for (const productToSave of productsToFinalizeSave) {
            const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
            let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
            const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
            let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

            if (unitPrice === 0 && quantityToAdd !== 0 && lineTotal !== 0 && lineTotal / quantityToAdd > 0) {
                unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
            }
            calculatedInvoiceTotalAmountFromProducts += lineTotal;

            let existingProductSnap;
            let existingProductRef;
            let foundBy = "";

            if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
                existingProductRef = doc(db, INVENTORY_COLLECTION, productToSave.id);
                existingProductSnap = await getDoc(existingProductRef);
                if (existingProductSnap.exists() && existingProductSnap.data().userId === userId) {
                    foundBy = `ID (${productToSave.id})`;
                } else {
                    existingProductSnap = undefined; // Not user's or doesn't exist by this ID
                }
            }

            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
                const qCat = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("catalogNumber", "==", productToSave.catalogNumber), limit(1));
                const catSnap = await getDocs(qCat);
                if (!catSnap.empty) {
                    existingProductSnap = catSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                    foundBy = `Catalog (${productToSave.catalogNumber})`;
                }
            }

            if ((!existingProductSnap || !existingProductSnap.exists()) && productToSave.barcode && productToSave.barcode.trim() !== '') {
                const qBar = query(collection(db, INVENTORY_COLLECTION), where("userId", "==", userId), where("barcode", "==", productToSave.barcode), limit(1));
                const barSnap = await getDocs(qBar);
                if (!barSnap.empty) {
                    existingProductSnap = barSnap.docs[0];
                    existingProductRef = existingProductSnap.ref;
                    foundBy = `Barcode (${productToSave.barcode})`;
                }
            }

            const productData: Omit<Product, 'id'> = {
                userId,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
                barcode: productToSave.barcode === null ? undefined : (productToSave.barcode?.trim() === '' ? undefined : productToSave.barcode),
                quantity: 0, // Will be set based on existing or new
                unitPrice: (unitPrice && unitPrice > 0) ? unitPrice : 0,
                salePrice: salePrice,
                minStockLevel: productToSave.minStockLevel,
                maxStockLevel: productToSave.maxStockLevel,
                imageUrl: productToSave.imageUrl,
                lineTotal: 0,
                lastUpdated: serverTimestamp()
            };

            if (existingProductSnap && existingProductSnap.exists() && existingProductRef) {
                console.log(`[finalizeSaveProductsService] Found existing product by ${foundBy}. ID: ${existingProductRef.id}`);
                const existingData = existingProductSnap.data() as Product;
                const updatedQuantity = (documentType === 'deliveryNote' && !tempInvoiceId?.includes('_sync'))
                    ? (existingData.quantity || 0) + quantityToAdd
                    : quantityToAdd; // For POS sync or if document is 'invoice', overwrite/set quantity

                const updatedProductData = {
                    ...existingData, // Start with existing data
                    ...productData,   // Overlay with new/updated fields from productData
                    quantity: updatedQuantity,
                    unitPrice: (productData.unitPrice && productData.unitPrice > 0) ? productData.unitPrice : (existingData.unitPrice || 0), // Prioritize new price if valid
                    salePrice: productData.salePrice !== undefined ? productData.salePrice : existingData.salePrice,
                    minStockLevel: productData.minStockLevel !== undefined ? productData.minStockLevel : existingData.minStockLevel,
                    maxStockLevel: productData.maxStockLevel !== undefined ? productData.maxStockLevel : existingData.maxStockLevel,
                    imageUrl: productData.imageUrl !== undefined ? productData.imageUrl : existingData.imageUrl,
                    lastUpdated: serverTimestamp(),
                };
                updatedProductData.lineTotal = parseFloat(((updatedProductData.quantity || 0) * (updatedProductData.unitPrice || 0)).toFixed(2));

                batchOp.update(existingProductRef, updatedProductData);
                savedProductsWithFinalIds.push({ ...updatedProductData, id: existingProductRef.id });
            } else {
                console.log(`[finalizeSaveProductsService] Product not found, creating new. Catalog: ${productData.catalogNumber}, Barcode: ${productData.barcode}`);
                if (!productData.catalogNumber && !productData.description && !productData.barcode) {
                    console.warn("[finalizeSaveProductsService] Skipping product with no identifier:", productToSave);
                    continue;
                }
                const newProductRef = doc(collection(db, INVENTORY_COLLECTION));
                productData.quantity = quantityToAdd; // Set initial quantity for new product
                productData.lineTotal = parseFloat(((productData.quantity || 0) * (productData.unitPrice || 0)).toFixed(2));
                batchOp.set(newProductRef, productData);
                savedProductsWithFinalIds.push({ ...productData, id: newProductRef.id });
            }
        }
    } else {
        console.log(`[finalizeSaveProductsService] Document type is '${documentType}'. Skipping inventory update, calculating total from input.`);
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
    finalGeneratedFileName = finalGeneratedFileName.replace(/[/\\?%*:|"<>]/g, '-'); // Sanitize file name

    const currentUploadTime = Timestamp.now();

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
        originalImagePreviewUri: originalImagePreviewUriToSave,
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave,
        paymentStatus: 'unpaid',
        paymentDueDate: paymentDueDate instanceof Date ? Timestamp.fromDate(paymentDueDate) : (typeof paymentDueDate === 'string' ? Timestamp.fromDate(new Date(paymentDueDate)) : undefined),
        invoiceDate: invoiceDate instanceof Date ? Timestamp.fromDate(invoiceDate) : (typeof invoiceDate === 'string' ? Timestamp.fromDate(new Date(invoiceDate)) : undefined),
        paymentMethod: paymentMethod || undefined,
        errorMessage: undefined,
    };

    let docRef;
    let isNewDocument = true;

    if (tempInvoiceId && tempInvoiceId.startsWith(`pending-inv-${userId}_`)) {
        // This is a placeholder ID created client-side, we want to create a new document in Firestore
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] Creating new document in Firestore, ignoring client-side tempId: ${tempInvoiceId}. New ID: ${docRef.id}`);
    } else if (tempInvoiceId) {
        // This tempInvoiceId is an actual Firestore ID (e.g., from POS sync or previous save attempt)
        docRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
        isNewDocument = !(await getDoc(docRef)).exists();
        console.log(`[finalizeSaveProductsService] Using provided tempInvoiceId as Firestore doc ID: ${tempInvoiceId}. Is new document: ${isNewDocument}`);
    } else {
        docRef = doc(collection(db, DOCUMENTS_COLLECTION));
        console.log(`[finalizeSaveProductsService] No tempInvoiceId provided, creating new document in Firestore. New ID: ${docRef.id}`);
    }

    if (isNewDocument) {
        batchOp.set(docRef, documentData);
    } else {
        batchOp.update(docRef, documentData); // Use update if the document might already exist by this ID
    }
    finalInvoiceRecord = { ...documentData, id: docRef.id };

    try {
      console.log("[finalizeSaveProductsService] Committing batch operation to Firestore...");
      await batchOp.commit();
      console.log("[finalizeSaveProductsService] Batch commit successful.");
    } catch (error) {
      console.error("[finalizeSaveProductsService] Error committing batch to Firestore:", error);
      throw error;
    }

    return { finalInvoiceRecord, savedProductsWithFinalIds };
}


export async function getSupplierSummariesService(userId: string): Promise<SupplierSummary[]> {
  if (!db) {
    console.error("Firestore (db) is not initialized. Cannot get supplier summaries.");
    return [];
  }
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
      supplierMap.set(data.name, { // Use name as key for easy lookup from invoices
        id: docSnap.id,
        userId,
        name: data.name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        paymentTerms: data.paymentTerms || undefined,
        invoiceCount: 0,
        totalSpent: 0,
        lastActivityDate: data.lastActivityDate instanceof Timestamp ? data.lastActivityDate.toDate().toISOString() : data.lastActivityDate,
        createdAt: data.createdAt,
      });
    });

    invoicesSnapshot.docs.forEach(docSnap => {
      const invoice = docSnap.data() as InvoiceHistoryItem;
      if (invoice.supplierName) {
        let supplierEntry = supplierMap.get(invoice.supplierName);
        if (supplierEntry) {
          supplierEntry.invoiceCount += 1;
          supplierEntry.totalSpent += (invoice.totalAmount || 0);
          const invoiceUploadTime = invoice.uploadTime ? (invoice.uploadTime instanceof Timestamp ? invoice.uploadTime.toDate() : new Date(invoice.uploadTime as string)) : null;

          if (invoiceUploadTime) {
            const currentLastActivityDate = supplierEntry.lastActivityDate ? new Date(supplierEntry.lastActivityDate as string) : null;
            if (!currentLastActivityDate || invoiceUploadTime > currentLastActivityDate) {
              supplierEntry.lastActivityDate = invoiceUploadTime.toISOString();
            }
          }
        } else {
          // Optionally create a new supplier entry if not found, or log it
           console.warn(`[getSupplierSummaries] Invoice found for supplier "${invoice.supplierName}" but supplier not in DB. Creating temporary entry.`);
           const newTempSupplier: SupplierSummary = {
                id: `temp-${invoice.supplierName.replace(/\s+/g, '_')}`, // Temporary ID
                userId,
                name: invoice.supplierName,
                invoiceCount: 1,
                totalSpent: invoice.totalAmount || 0,
                lastActivityDate: invoice.uploadTime ? (invoice.uploadTime instanceof Timestamp ? invoice.uploadTime.toDate().toISOString() : invoice.uploadTime as string) : undefined,
                createdAt: serverTimestamp(), // Or set to invoice upload time
            };
            supplierMap.set(invoice.supplierName, newTempSupplier);
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

  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Supplier name cannot be empty.");

  const q = query(collection(db, SUPPLIERS_COLLECTION), where("userId", "==", userId), where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Supplier with name "${normalizedName}" already exists for this user.`);
  }

  const newSupplierData = {
    userId,
    name: normalizedName,
    phone: contactInfo.phone?.trim() || null,
    email: contactInfo.email?.trim() || null,
    paymentTerms: contactInfo.paymentTerms?.trim() || null,
    invoiceCount: 0,
    totalSpent: 0,
    lastActivityDate: null,
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, SUPPLIERS_COLLECTION), newSupplierData);
  return { ...newSupplierData, id: docRef.id, createdAt: Timestamp.now() } as SupplierSummary;
}

export async function deleteSupplierService(supplierId: string, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");
  const docRef = doc(db, SUPPLIERS_COLLECTION, supplierId);
  // Verify ownership before deleting
  const supplierDoc = await getDoc(docRef);
  if (!supplierDoc.exists() || supplierDoc.data().userId !== userId) {
    throw new Error("Supplier not found or permission denied.");
  }
  await deleteDoc(docRef);
}

export async function updateSupplierContactInfoService(supplierIdOrName: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId: string): Promise<void> {
  if (!db) throw new Error("Database not initialized.");
  if (!userId) throw new Error("User authentication is required.");

  let supplierRef;
  // Try to get by ID first
  let supplierDoc = await getDoc(doc(db, SUPPLIERS_COLLECTION, supplierIdOrName));
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

  const updateData: any = { userId }; // Always ensure userId for rules
  let hasChanges = false;
  if (contactInfo.phone !== undefined) { updateData.phone = contactInfo.phone.trim() || null; hasChanges = true; }
  if (contactInfo.email !== undefined) { updateData.email = contactInfo.email.trim() || null; hasChanges = true; }
  if (contactInfo.paymentTerms !== undefined) { updateData.paymentTerms = contactInfo.paymentTerms.trim() || null; hasChanges = true; }

  if (hasChanges) {
    await updateDoc(supplierRef, updateData);
  }
}

export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await setDoc(userSettingsRef, { posSystemId: systemId, posConfig: config, userId }, { merge: true });
}

export async function getPosSettingsService(userId: string): Promise<StoredPosSettings | null> {
  if (!db || !userId) return null;
  const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
  const docSnap = await getDoc(userSettingsRef);
  if (docSnap.exists() && docSnap.data().posSystemId) {
    const data = docSnap.data();
    return { systemId: data.posSystemId, config: data.posConfig || {} };
  }
  return null;
}

export async function clearPosSettingsService(userId: string): Promise<void> {
    if (!db || !userId) throw new Error("User authentication is required.");
    const userSettingsRef = doc(db, USER_SETTINGS_COLLECTION, userId);
    await updateDoc(userSettingsRef, {
        posSystemId: null,
        posConfig: null
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
    // Return a default structure if no settings doc exists, ensuring userId is present
    return {
        userId,
        reminderDaysBefore: undefined, // Or your default
        posSystemId: undefined,
        posConfig: {},
        accountantSettings: {},
        monthlyBudget: undefined,
        kpiPreferences: undefined,
        quickActionPreferences: undefined,
    };
}

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
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000;
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(TEMP_DATA_KEY_PREFIX) || key.startsWith(TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX) || key.startsWith(TEMP_COMPRESSED_IMAGE_KEY_PREFIX))) {
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) continue;
        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;

        if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        } else if (!timestamp && emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_NO_USER_'))) {
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All'}).`);
}
