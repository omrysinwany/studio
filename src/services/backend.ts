
// src/services/backend.ts
'use client';

// @ts-ignore firebase.ts will provide the db and auth instances
import { db } from '@/lib/firebase';
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
  orderBy
} from "firebase/firestore";
import type { PosConnectionConfig } from './pos-integration/pos-adapter.interface';

export interface User {
  id: string; // Firebase Auth UID
  username?: string; // displayName from Firebase Auth or custom
  email?: string | null; // email from Firebase Auth
  createdAt?: Timestamp | FieldValue; // Firestore Timestamp
  lastLoginAt?: Timestamp | FieldValue; // Firestore Timestamp
  // Add any other user-specific fields you want to store in Firestore
}

// Firestore FieldValue type, for serverTimestamp
import type { FieldValue } from "firebase/firestore";


export interface Product {
  id: string;
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
}

export interface InvoiceHistoryItem {
  id: string; // Can be temp ID initially, then Firestore ID
  userId: string; // To associate with a user
  originalFileName: string; // Original name of the uploaded file
  generatedFileName: string; // Name like Supplier_InvoiceNumber
  uploadTime: string | Timestamp; // ISO string or Firestore Timestamp
  status: 'pending' | 'processing' | 'completed' | 'error';
  documentType: 'deliveryNote' | 'invoice' | 'paymentReceipt';
  supplierName?: string;
  invoiceNumber?: string;
  invoiceDate?: string | Timestamp;
  totalAmount?: number;
  paymentMethod?: string;
  paymentDueDate?: string | Timestamp;
  paymentStatus: 'paid' | 'unpaid' | 'pending_payment';
  paymentReceiptImageUri?: string; // URL from Firebase Storage
  originalImagePreviewUri?: string; // Data URI or URL from Firebase Storage
  compressedImageForFinalRecordUri?: string; // URL from Firebase Storage
  errorMessage?: string;
  linkedDeliveryNoteId?: string; // For linking receipts to delivery notes
  // products?: Product[]; // Store line items in a subcollection for scalability
}

export interface DocumentLineItem {
  // id: string; // Firestore will generate this
  productId?: string; // Link to InventoryProduct.id if known
  productName: string; // Name as on the document
  catalogNumber?: string;
  barcode?: string;
  quantity: number;
  unitPrice: number; // Purchase price from document
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
  userId: string; // Corresponds to Firebase Auth UID
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
  date: string | Timestamp; // ISO string or Firestore Timestamp
  category: string; // User-defined category name
  _internalCategoryKey?: string; // For internal mapping if needed
  // categoryId?: string; // If you create a separate 'ExpenseCategories' collection
}

export interface ExpenseTemplate {
  id: string; // Firestore document ID
  userId: string;
  name: string;
  category: string;
  description: string;
  amount: number;
}


// --- Storage Keys (Now less relevant for core data, but good for temporary/local UI state) ---
export const INVENTORY_STORAGE_KEY_BASE = 'invoTrack_inventory';
export const INVOICES_STORAGE_KEY_BASE = 'invoTrack_invoices';
export const POS_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_posSettings';
export const SUPPLIERS_STORAGE_KEY_BASE = 'invoTrack_suppliers';
export const ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_accountantSettings';
export const USER_SETTINGS_STORAGE_KEY_BASE = 'invoTrack_userSettings';
export const OTHER_EXPENSES_STORAGE_KEY_BASE = 'invoTrack_otherExpenses';
export const EXPENSE_TEMPLATES_STORAGE_KEY_BASE = 'invoTrack_expenseTemplates';
export const MONTHLY_BUDGET_STORAGE_KEY_BASE = 'invoTrack_monthlyBudget';


export const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
export const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
export const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';

export const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.4 * 1024 * 1024;
export const MAX_SCAN_RESULTS_SIZE_BYTES = 0.5 * 1024 * 1024;
export const MAX_INVOICE_HISTORY_ITEMS = 50; // Reduced for localStorage; Firestore handles much more.


interface StoredPosSettings {
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
    return `${baseKey}_SHARED_OR_ERROR`;
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
  if (!userId) return false;
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
        return true;
      } catch (retryError) {
        console.error(`Error writing ${storageKey} to localStorage even after cleanup:`, retryError);
        throw retryError;
      }
    } else {
      throw error;
    }
  }
};

// --- User Management with Firestore ---
const USERS_COLLECTION = "users";

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

    // Check if user document already exists to set createdAt only once
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      dataToSave.createdAt = serverTimestamp();
    }
    dataToSave.lastLoginAt = serverTimestamp();

    await setDoc(userRef, dataToSave, { merge: true });
    console.log("User data saved to Firestore for UID:", userData.id);
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
      // Convert Firestore Timestamps to JS Date objects or ISO strings if needed
      return {
        id: docSnap.id,
        username: data.username,
        email: data.email,
        createdAt: data.createdAt, // Keep as Firestore Timestamp or convert
        lastLoginAt: data.lastLoginAt, // Keep as Firestore Timestamp or convert
      } as User;
    } else {
      console.log("No such user document in Firestore for UID:", userId);
      return null;
    }
  } catch (error) {
    console.error("Error fetching user from Firestore:", error);
    throw error;
  }
}


// --- Product & Inventory Management (Placeholder - to be refactored for Firestore) ---

export async function getProductsService(userId?: string): Promise<Product[]> {
  if (typeof window === 'undefined' || !userId) return [];
  return getStoredData<Product>(INVENTORY_STORAGE_KEY_BASE, userId, []);
}

export async function getProductByIdService(productId: string, userId?: string): Promise<Product | null> {
   if (!userId) return null;
   const inventory = await getProductsService(userId);
   return inventory.find(p => p.id === productId) || null;
}

export async function updateProductService(productId: string, updatedData: Partial<Product>, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let currentInventory = await getProductsService(userId);
  const productIndex = currentInventory.findIndex(p => p.id === productId);
  if (productIndex === -1) throw new Error(`Product with ID ${productId} not found.`);

  const existingProduct = currentInventory[productIndex];
  const productAfterUpdateAttempt: Product = {
    ...existingProduct,
    ...updatedData,
    id: productId,
  };

   if (updatedData.quantity !== undefined || updatedData.unitPrice !== undefined) {
       const quantity = Number(productAfterUpdateAttempt.quantity) || 0;
       const unitPrice = Number(productAfterUpdateAttempt.unitPrice) || 0;
       productAfterUpdateAttempt.lineTotal = parseFloat((quantity * unitPrice).toFixed(2));
   }
    if (!productAfterUpdateAttempt.shortName) {
         const description = productAfterUpdateAttempt.description || 'No Description';
         productAfterUpdateAttempt.shortName = description.split(' ').slice(0, 3).join(' ');
    }
    productAfterUpdateAttempt.barcode = updatedData.barcode === null ? undefined : (updatedData.barcode ?? existingProduct.barcode);
    productAfterUpdateAttempt.salePrice = updatedData.salePrice === null || updatedData.salePrice === undefined
                              ? undefined
                              : (Number.isFinite(Number(updatedData.salePrice)) ? Number(updatedData.salePrice) : existingProduct.salePrice);
    productAfterUpdateAttempt.minStockLevel = updatedData.minStockLevel === null || updatedData.minStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.minStockLevel)) ? Number(updatedData.minStockLevel) : existingProduct.minStockLevel);
    productAfterUpdateAttempt.maxStockLevel = updatedData.maxStockLevel === null || updatedData.maxStockLevel === undefined
                                  ? undefined
                                  : (Number.isFinite(Number(updatedData.maxStockLevel)) ? Number(updatedData.maxStockLevel) : existingProduct.maxStockLevel);
    productAfterUpdateAttempt.imageUrl = updatedData.imageUrl === null ? undefined : (updatedData.imageUrl ?? existingProduct.imageUrl);

  currentInventory[productIndex] = productAfterUpdateAttempt;
  saveStoredData(INVENTORY_STORAGE_KEY_BASE, currentInventory, userId);
}

export async function deleteProductService(productId: string, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let currentInventory = await getProductsService(userId);
  const updatedInventory = currentInventory.filter(p => p.id !== productId);
  saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
}

export async function clearInventoryService(userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    saveStoredData(INVENTORY_STORAGE_KEY_BASE, [], userId);
}


// --- Invoice History Management (Placeholder - to be refactored for Firestore) ---

export async function getInvoicesService(userId?: string): Promise<InvoiceHistoryItem[]> {
  if (typeof window === 'undefined' || !userId) return [];
  const invoicesRaw = getStoredData<InvoiceHistoryItem>(INVOICES_STORAGE_KEY_BASE, userId, []);
  return invoicesRaw.map(inv => ({
    ...inv,
    id: inv.id || `inv-get-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2, 9)}`,
    userId: userId, // Ensure userId is set
    uploadTime: inv.uploadTime, // Keep as string from localStorage
    paymentStatus: inv.paymentStatus || 'unpaid',
    documentType: inv.documentType || 'deliveryNote',
  }));
}

export async function updateInvoiceService(invoiceId: string, updatedData: Partial<InvoiceHistoryItem>, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let currentInvoices = await getInvoicesService(userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);
  if (invoiceIndex === -1) throw new Error(`Invoice with ID ${invoiceId} not found.`);
  currentInvoices[invoiceIndex] = { ...currentInvoices[invoiceIndex], ...updatedData, userId };
  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
}

export async function updateInvoicePaymentStatusService(invoiceId: string, paymentStatus: InvoiceHistoryItem['paymentStatus'], userId?: string, paymentReceiptImageUri?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let currentInvoices = await getInvoicesService(userId);
  const invoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceId);
  if (invoiceIndex === -1) throw new Error(`Invoice with ID ${invoiceId} not found.`);
  currentInvoices[invoiceIndex].paymentStatus = paymentStatus;
  if (paymentStatus === 'paid' && paymentReceiptImageUri) {
    currentInvoices[invoiceIndex].paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== 'paid') {
    currentInvoices[invoiceIndex].paymentReceiptImageUri = undefined;
  }
  saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);
}

export async function deleteInvoiceService(invoiceId: string, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let currentInvoices = await getInvoicesService(userId);
  const updatedInvoices = currentInvoices.filter(inv => inv.id !== invoiceId);
  saveStoredData(INVOICES_STORAGE_KEY_BASE, updatedInvoices, userId);
}

// --- Main Service Logic for Saving Products & Invoice History ---
export async function finalizeSaveProductsService(
    productsToFinalizeSave: Product[],
    originalFileNameFromUpload: string,
    documentType: 'deliveryNote' | 'invoice',
    userId?: string,
    tempInvoiceId?: string, // This is the ID from the 'pending' record
    extractedInvoiceNumber?: string,
    finalSupplierName?: string,
    extractedTotalAmount?: number,
    paymentDueDate?: string,
    invoiceDate?: string,
    paymentMethod?: string,
    originalImagePreviewUriToSave?: string, // URL from Storage, or Data URI if small
    compressedImageForFinalRecordUriToSave?: string // URL from Storage
): Promise<{
  inventoryPruned: boolean;
  finalInvoiceRecord?: InvoiceHistoryItem;
  savedProductsWithFinalIds?: Product[];
}> {
    if (!userId) {
      throw new Error("User authentication is required to save products and invoice history.");
    }

    let currentInventory = await getProductsService(userId);
    let currentInvoices = await getInvoicesService(userId);
    let inventoryPruned = false;
    const savedProductsWithFinalIds: Product[] = [];

    let calculatedInvoiceTotalAmountFromProducts = 0;

    // Process products for inventory
    if (documentType === 'deliveryNote' || (documentType === 'invoice' && tempInvoiceId?.includes('_sync'))) {
      const updatedInventory = [...currentInventory];
      productsToFinalizeSave.forEach((productToSave) => {
        const quantityToAdd = parseFloat(String(productToSave.quantity)) || 0;
        let unitPrice = parseFloat(String(productToSave.unitPrice)) || 0;
        const salePrice = productToSave.salePrice !== undefined && !isNaN(parseFloat(String(productToSave.salePrice))) ? parseFloat(String(productToSave.salePrice)) : undefined;
        let lineTotal = parseFloat(String(productToSave.lineTotal)) || 0;

        if (quantityToAdd !== 0 && lineTotal !== 0 && unitPrice === 0) {
            unitPrice = parseFloat((lineTotal / quantityToAdd).toFixed(2));
        }
        calculatedInvoiceTotalAmountFromProducts += lineTotal;

        let existingIndex = -1;
        if (productToSave.id && !productToSave.id.startsWith('prod-temp-') && !productToSave.id.includes('-new')) {
             existingIndex = updatedInventory.findIndex(p => p.id === productToSave.id);
        }
        if (existingIndex === -1 && productToSave.catalogNumber && productToSave.catalogNumber !== 'N/A') {
            existingIndex = updatedInventory.findIndex(p => p.catalogNumber === productToSave.catalogNumber);
        }
        if (existingIndex === -1 && productToSave.barcode && productToSave.barcode.trim() !== '') {
            existingIndex = updatedInventory.findIndex(p => p.barcode === productToSave.barcode);
        }

        if (existingIndex !== -1) {
            const existingProduct = updatedInventory[existingIndex];
            if (documentType === 'deliveryNote') {
              existingProduct.quantity = (existingProduct.quantity || 0) + quantityToAdd;
            } else { // POS Sync or Invoice with products - overwrite/set quantity
              existingProduct.quantity = quantityToAdd;
            }
            existingProduct.unitPrice = (unitPrice && unitPrice > 0) ? unitPrice : existingProduct.unitPrice;
            existingProduct.description = productToSave.description || existingProduct.description;
            existingProduct.shortName = productToSave.shortName || existingProduct.shortName;
            existingProduct.barcode = productToSave.barcode === null ? undefined : (productToSave.barcode ?? existingProduct.barcode);
            existingProduct.catalogNumber = productToSave.catalogNumber || existingProduct.catalogNumber;
            existingProduct.salePrice = salePrice ?? existingProduct.salePrice;
            existingProduct.minStockLevel = productToSave.minStockLevel ?? existingProduct.minStockLevel;
            existingProduct.maxStockLevel = productToSave.maxStockLevel ?? existingProduct.maxStockLevel;
            existingProduct.imageUrl = productToSave.imageUrl === null ? undefined : (productToSave.imageUrl ?? existingProduct.imageUrl);
            existingProduct.lineTotal = parseFloat(((existingProduct.quantity || 0) * existingProduct.unitPrice).toFixed(2));
            savedProductsWithFinalIds.push({...existingProduct});
        } else {
            if (!productToSave.catalogNumber && !productToSave.description && !productToSave.barcode) return;
            const newId = `prod-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2, 7)}`;
            const newProductEntry: Product = {
                ...productToSave,
                id: newId,
                quantity: quantityToAdd,
                unitPrice: unitPrice,
                salePrice: salePrice,
                lineTotal: lineTotal,
                catalogNumber: productToSave.catalogNumber || 'N/A',
                description: productToSave.description || 'No Description',
                shortName: productToSave.shortName || (productToSave.description || 'No Description').split(' ').slice(0, 3).join(' '),
            };
            updatedInventory.push(newProductEntry);
            savedProductsWithFinalIds.push({...newProductEntry});
        }
      });
      saveStoredData(INVENTORY_STORAGE_KEY_BASE, updatedInventory, userId);
    } else {
        // For 'invoice' type not from sync, we don't update inventory from its line items,
        // but we still need to calculate its total if not provided
        productsToFinalizeSave.forEach(productToSave => {
            calculatedInvoiceTotalAmountFromProducts += (parseFloat(String(productToSave.lineTotal)) || 0);
        });
    }


    // Process invoice history item
    let finalInvoiceRecord: InvoiceHistoryItem | undefined = undefined;
    const finalStatus: InvoiceHistoryItem['status'] = 'completed'; // Assume completion if this service is called
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

    const invoiceHistoryId = tempInvoiceId || `inv-${Date.now()}-${userId.slice(0,3)}-${Math.random().toString(36).substring(2,9)}`;
    const existingInvoiceIndex = currentInvoices.findIndex(inv => inv.id === invoiceHistoryId);

    const invoiceRecordData: Partial<InvoiceHistoryItem> = {
        generatedFileName: finalGeneratedFileName,
        originalFileName: originalFileNameFromUpload, // Keep original name
        status: finalStatus,
        documentType: documentType,
        invoiceNumber: extractedInvoiceNumber,
        supplierName: finalSupplierName,
        totalAmount: finalInvoiceTotalAmount,
        originalImagePreviewUri: originalImagePreviewUriToSave, // This should be a URL from Storage now
        compressedImageForFinalRecordUri: compressedImageForFinalRecordUriToSave, // This should be a URL from Storage now
        paymentStatus: 'unpaid', // Default for new/updated, can be changed later
        paymentDueDate: paymentDueDate,
        invoiceDate: invoiceDate,
        paymentMethod: paymentMethod,
        userId: userId,
        uploadTime: new Date().toISOString(), // Set or update upload time
    };

    if (existingInvoiceIndex !== -1) {
        currentInvoices[existingInvoiceIndex] = { ...currentInvoices[existingInvoiceIndex], ...invoiceRecordData, id: invoiceHistoryId };
        finalInvoiceRecord = currentInvoices[existingInvoiceIndex];
    } else {
        const newRecord = { ...invoiceRecordData, id: invoiceHistoryId, paymentStatus: 'unpaid' } as InvoiceHistoryItem;
        currentInvoices.unshift(newRecord); // Add to the beginning
        finalInvoiceRecord = newRecord;
    }

    if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
        currentInvoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
        currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
    }
    saveStoredData(INVOICES_STORAGE_KEY_BASE, currentInvoices, userId);

    return { inventoryPruned, finalInvoiceRecord, savedProductsWithFinalIds };
}


// --- Supplier Management (Placeholder - to be refactored for Firestore) ---
export async function getSupplierSummariesService(userId?: string): Promise<SupplierSummary[]> {
  if (!userId) return [];
  const invoices = await getInvoicesService(userId);
  const storedSuppliers = getStoredData<{ id: string; name: string; phone?: string; email?: string, paymentTerms?: string, createdAt: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  const supplierMap = new Map<string, SupplierSummary>();

  storedSuppliers.forEach(s => {
    if (s && s.name) {
      supplierMap.set(s.name, {
        id: s.id,
        userId: userId,
        name: s.name,
        invoiceCount: 0,
        totalSpent: 0,
        phone: s.phone || undefined,
        email: s.email || undefined,
        paymentTerms: s.paymentTerms || undefined,
        lastActivityDate: undefined,
        createdAt: s.createdAt ? Timestamp.fromDate(new Date(s.createdAt)) : serverTimestamp()
      });
    }
  });

  invoices.forEach(invoice => {
    if (invoice.supplierName && invoice.status === 'completed') {
      let summary = supplierMap.get(invoice.supplierName);
      if (summary) {
        summary.invoiceCount += 1;
        summary.totalSpent += (invoice.totalAmount || 0);
        const currentActivityDate = invoice.uploadTime ? new Date(invoice.uploadTime as string) : null;
        if (currentActivityDate && (!summary.lastActivityDate || currentActivityDate > new Date(summary.lastActivityDate as string))) {
          summary.lastActivityDate = currentActivityDate.toISOString();
        }
      }
    }
  });

  return Array.from(supplierMap.values()).sort((a, b) => {
    const dateA = a.lastActivityDate ? new Date(a.lastActivityDate as string).getTime() : 0;
    const dateB = b.lastActivityDate ? new Date(b.lastActivityDate as string).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA;
    return a.name.localeCompare(b.name);
  });
}

export async function createSupplierService(name: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId?: string): Promise<SupplierSummary> {
  if (!userId) throw new Error("User authentication is required.");
  let suppliers = getStoredData<{ id: string; name: string; phone?: string; email?: string, paymentTerms?: string, createdAt: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  if (suppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Supplier with name "${name}" already exists.`);
  }
  const newSupplierData = { 
    id: `supplier-${Date.now()}-${userId.slice(0,3)}`,
    name, 
    phone: contactInfo.phone, 
    email: contactInfo.email, 
    paymentTerms: contactInfo.paymentTerms,
    createdAt: new Date().toISOString() 
  };
  suppliers.push(newSupplierData);
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
  return { 
    id: newSupplierData.id, 
    userId, name, 
    invoiceCount: 0, 
    totalSpent: 0, 
    ...contactInfo, 
    lastActivityDate: undefined,
    createdAt: Timestamp.fromDate(new Date(newSupplierData.createdAt))
  };
}

export async function deleteSupplierService(supplierId: string, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let suppliers = getStoredData<{ id: string; name: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  const updatedSuppliers = suppliers.filter(s => s.id !== supplierId);
  if (suppliers.length === updatedSuppliers.length && suppliers.some(s => s.id === supplierId)) {
     throw new Error(`Supplier with ID "${supplierId}" found but not removed. This is unexpected.`);
  }
  saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, updatedSuppliers, userId);
}

export async function updateSupplierContactInfoService(supplierId: string, contactInfo: { phone?: string; email?: string, paymentTerms?: string }, userId?: string): Promise<void> {
  if (!userId) throw new Error("User authentication is required.");
  let suppliers = getStoredData<{ id: string; name: string; phone?: string; email?: string, paymentTerms?: string, createdAt: string }>(SUPPLIERS_STORAGE_KEY_BASE, userId, []);
  const supplierIndex = suppliers.findIndex(s => s.id === supplierId);
  if (supplierIndex !== -1) {
    const existingSupplier = suppliers[supplierIndex];
    suppliers[supplierIndex] = {
      ...existingSupplier,
      phone: contactInfo.phone !== undefined ? contactInfo.phone : existingSupplier.phone,
      email: contactInfo.email !== undefined ? contactInfo.email : existingSupplier.email,
      paymentTerms: contactInfo.paymentTerms !== undefined ? contactInfo.paymentTerms : existingSupplier.paymentTerms,
    };
    saveStoredData(SUPPLIERS_STORAGE_KEY_BASE, suppliers, userId);
  } else {
    throw new Error(`Supplier with ID "${supplierId}" not found.`);
  }
}

// --- Settings Management (Placeholder - to be refactored for Firestore) ---
export async function savePosSettingsService(systemId: string, config: PosConnectionConfig, userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    const settings: StoredPosSettings = { systemId, config };
    saveStoredData(POS_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getPosSettingsService(userId?: string): Promise<StoredPosSettings | null> {
  if (!userId) return null;
  return getStoredObject<StoredPosSettings>(POS_SETTINGS_STORAGE_KEY_BASE, userId);
}

export async function clearPosSettingsService(userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    const storageKey = getStorageKey(POS_SETTINGS_STORAGE_KEY_BASE, userId);
    localStorage.removeItem(storageKey);
}

export async function saveAccountantSettingsService(settings: AccountantSettings, userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    saveStoredData(ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getAccountantSettingsService(userId?: string): Promise<AccountantSettings | null> {
    if (!userId) return null;
    return getStoredObject<AccountantSettings>(ACCOUNTANT_SETTINGS_STORAGE_KEY_BASE, userId);
}

export async function saveUserSettingsService(settings: UserSettings, userId?: string): Promise<void> {
    if (!userId) throw new Error("User authentication is required.");
    saveStoredData(USER_SETTINGS_STORAGE_KEY_BASE, settings, userId);
}

export async function getUserSettingsService(userId?: string): Promise<UserSettings | null> {
    if (!userId) return null;
    const settings = getStoredObject<UserSettings>(USER_SETTINGS_STORAGE_KEY_BASE, userId);
    // Ensure we return a proper UserSettings object even if parts are missing from storage
    return settings ? { userId, ...settings } : { userId };
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
        if (userIdToClear && !key.includes(`_${userIdToClear}_`)) continue;
        const parts = key.split('_');
        const timestampString = parts.find(part => /^\d{13,}$/.test(part));
        const timestamp = timestampString ? parseInt(timestampString, 10) : null;
        if (timestamp && !isNaN(timestamp) && (now - timestamp > EXPIRY_DURATION_MS)) {
          keysToRemove.push(key);
        } else if (!timestamp && emergencyClear && (userIdToClear || !key.includes('_SHARED_OR_ERROR_'))) {
          keysToRemove.push(key);
        }
    }
  }
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); itemsCleared++; } catch (e) { console.error(`Error removing key ${key}:`, e); }
  });
  if (itemsCleared > 0) console.log(`Cleared ${itemsCleared} old/emergency temp scan items (User: ${userIdToClear || 'All'}).`);
}


export interface AuthResponse {
  token: string;
  user: User;
}
// Mock services for login and register are removed as Firebase Auth is used directly.
