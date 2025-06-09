"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  FieldValue,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Query,
  QuerySnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  increment,
  GeoPoint,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createOrUpdateCaspitProductAction,
  deactivateCaspitProductAction,
} from "@/actions/caspit-actions";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";

// =================================================================
// COLLECTION AND SUBCOLLECTION NAMES
// =================================================================
export const USERS_COLLECTION = "users";
export const INVENTORY_SUBCOLLECTION = "inventoryProducts";
export const DOCUMENTS_SUBCOLLECTION = "documents";
export const SUPPLIERS_SUBCOLLECTION = "suppliers";
export const OTHER_EXPENSES_SUBCOLLECTION = "otherExpenses";
export const EXPENSE_CATEGORIES_SUBCOLLECTION = "expenseCategories";
export const USER_SETTINGS_SUBCOLLECTION = "settings";
// Constants for temporary scan data management
export const TEMP_DATA_KEY_PREFIX = "temp-scan-result-";
export const MAX_SCAN_RESULTS_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_INVOICE_HISTORY_ITEMS = 10;
const TEMP_DATA_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// =================================================================
// TYPE DEFINITIONS
// =================================================================

export interface User {
  id: string;
  username?: string | null;
  email?: string | null;
  createdAt?: Timestamp | FieldValue;
  lastLoginAt?: Timestamp | FieldValue;
}

export interface Product {
  id: string;
  userId: string;
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
  lastUpdated?: Timestamp | FieldValue;
  caspitProductId?: string | null;
  isActive?: boolean;
}

export interface Invoice {
  id: string;
  userId: string;
  originalFileName: string;
  uploadTime: string | Timestamp | FieldValue;
  status: "pending" | "processing" | "completed" | "error" | "archived";
  documentType: "deliveryNote" | "invoice" | "paymentReceipt";
  supplierName?: string | null;
  supplierId?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | Timestamp | FieldValue | null;
  totalAmount?: number | null;
  itemCount?: number;
  paymentMethod?: string | null;
  dueDate?: string | Timestamp | FieldValue | null;
  paymentDate?: string | Timestamp | FieldValue | null;
  paymentStatus: "paid" | "unpaid" | "pending_payment";
  products: Product[];
  isArchived?: boolean;
  errorMessage?: string | null;
  caspitPurchaseDocId?: string | null;
  lastUpdated?: Timestamp | FieldValue;
}

export interface Supplier {
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
  caspitAccountId?: string | null;
}

export interface OtherExpense {
  id: string;
  userId: string;
  description: string;
  amount: number;
  date: string | Timestamp;
  categoryId?: string | null;
  paymentDate?: string | Timestamp;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  userId: string;
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
  userId: string;
  reminderDaysBefore?: number | null;
  posSystemId?: string | null;
  posConfig?: PosConnectionConfig | null;
  accountantSettings?: AccountantSettings | null;
  monthlyBudget?: number | null;
  kpiPreferences?: KpiPreferences | null;
  quickActionPreferences?: QuickActionPreferences | null;
}

export interface ProductPriceDiscrepancy extends Product {
  existingUnitPrice: number;
  newUnitPrice: number;
}

export interface PriceCheckResult {
  productsToSaveDirectly: Product[];
  priceDiscrepancies: ProductPriceDiscrepancy[];
}

// =================================================================
// SUBCOLLECTION HELPERS
// =================================================================

const getUserSubcollectionRef = <T>(userId: string, collectionName: string) => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId) throw new Error("User ID is required to access subcollections.");
  return collection(db, USERS_COLLECTION, userId, collectionName) as Query<T>;
};

const getUserSubcollectionDocRef = (
  userId: string,
  collectionName: string,
  docId: string
) => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId || !docId) {
    throw new Error(
      "User ID and Document ID are required to access a subcollection document."
    );
  }
  return doc(db, USERS_COLLECTION, userId, collectionName, docId);
};

// =================================================================
// SERVICE FUNCTIONS
// =================================================================

// USER SETTINGS
// -----------------------------------------------------------------

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  if (!db || !userId) {
    throw new Error(
      "DB not initialized or User ID missing for getUserSettingsService."
    );
  }

  const userSettingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );
  const docSnap = await getDoc(userSettingsRef as any);

  const defaultSettings: UserSettings = {
    userId,
    posSystemId: null,
    posConfig: null,
    accountantSettings: { name: null, email: null, phone: null },
    monthlyBudget: null,
    reminderDaysBefore: 3,
    kpiPreferences: {
      visibleKpiIds: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
      ],
      kpiOrder: [
        "totalItems",
        "inventoryValue",
        "grossProfit",
        "currentMonthExpenses",
      ],
    },
    quickActionPreferences: {
      visibleQuickActionIds: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
      ],
      quickActionOrder: [
        "scanDocument",
        "viewInventory",
        "viewDocuments",
        "addExpense",
      ],
    },
  };

  if (docSnap.exists()) {
    const settingsData = docSnap.data();
    if (settingsData) {
      return {
        ...defaultSettings,
        ...settingsData,
        userId,
      };
    }
  }
  return defaultSettings;
}

export async function saveUserSettingsService(
  settings: Partial<Omit<UserSettings, "userId">>,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const userSettingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );

  const settingsToSave = { ...settings };

  await setDoc(userSettingsRef as any, settingsToSave, { merge: true });
}

// INVENTORY / PRODUCTS
// -----------------------------------------------------------------

export async function getProductsService(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<Product[]> {
  if (!db || !userId) return [];
  const productsRef = getUserSubcollectionRef<Product>(
    userId,
    INVENTORY_SUBCOLLECTION
  );

  const q = options.includeInactive
    ? query(productsRef, orderBy("description"))
    : query(
        productsRef,
        where("isActive", "!=", false),
        orderBy("description")
      );

  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    ...(doc.data() as Product),
    id: doc.id,
    userId,
  }));
}

export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  if (!db || !userId || !productId) return null;
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  const docSnap = await getDoc(productRef);
  if (docSnap.exists()) {
    return { ...(docSnap.data() as Product), id: docSnap.id, userId };
  }
  return null;
}

export async function updateProductService(
  productId: string,
  productData: Partial<Product>,
  userId: string
): Promise<void> {
  if (!db || !userId || !productId) throw new Error("Missing parameters.");
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );

  const dataToUpdate = { ...productData };
  dataToUpdate.lastUpdated = serverTimestamp();

  await updateDoc(productRef, dataToUpdate);

  // Caspit Integration
  const userSettings = await getUserSettingsService(userId);
  if (userSettings?.posSystemId === "caspit" && dataToUpdate.caspitProductId) {
    const product = await getProductByIdService(productId, userId);
    if (product) {
      await createOrUpdateCaspitProductAction(userSettings.posConfig!, product);
    }
  }
}

export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );

  const docSnap = await getDoc(productRef);
  if (!docSnap.exists()) {
    throw new Error("Product not found for deletion.");
  }
  const productData = docSnap.data();
  if (!productData) {
    throw new Error("Product data is missing for deletion.");
  }
  const productToDeactivate = {
    ...productData,
    id: docSnap.id,
    userId,
  } as Product;

  if (productToDeactivate.caspitProductId) {
    const userSettings = await getUserSettingsService(userId);
    if (userSettings?.posSystemId === "caspit") {
      const caspitResult = await deactivateCaspitProductAction(
        userSettings.posConfig!,
        productToDeactivate
      );
      if (!caspitResult.success) {
        console.error(
          `Failed to deactivate product in Caspit: ${caspitResult.message}`
        );
      }
    }
  }

  await updateDoc(productRef, {
    isActive: false,
    lastUpdated: serverTimestamp(),
  });
}

export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  await updateDoc(productRef, {
    isActive: true,
    lastUpdated: serverTimestamp(),
  });
}

export async function clearInventoryService(userId: string): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const productsRef = getUserSubcollectionRef(userId, INVENTORY_SUBCOLLECTION);
  const querySnapshot = await getDocs(productsRef);

  if (querySnapshot.empty) {
    return;
  }

  const batch = writeBatch(db);
  querySnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
}

// INVOICES / DOCUMENTS
// -----------------------------------------------------------------

export function getStorageKey(userId: string): string {
  if (!userId) {
    console.error(
      "[getStorageKey] User ID is required to generate a storage key."
    );
    throw new Error("User ID is required.");
  }
  return `${TEMP_DATA_KEY_PREFIX}${userId}`;
}

// Function to clear only the specific user's temporary scan data
export function clearTemporaryScanData(userId: string): void {
  if (typeof window !== "undefined" && userId) {
    const key = getStorageKey(userId);
    console.log(
      `[clearTemporaryScanData] Clearing temporary data for key: ${key}`
    );
    localStorage.removeItem(key);
  }
}

// Function to clear old temporary scan data for all users (or based on stored keys)
export function clearOldTemporaryScanData(
  force = false,
  currentUserId?: string
): void {
  if (typeof window === "undefined") return;

  try {
    const now = new Date().getTime();
    // Clear the current user's data if force is true
    if (force && currentUserId) {
      clearTemporaryScanData(currentUserId);
      return;
    }

    // Iterate over all localStorage keys to find and clear expired scan data
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(TEMP_DATA_KEY_PREFIX)) {
        const itemStr = localStorage.getItem(key);
        if (itemStr) {
          try {
            const item = JSON.parse(itemStr);
            // Assuming the stored item has a 'timestamp' property
            if (
              item.timestamp &&
              now - item.timestamp > TEMP_DATA_EXPIRATION_MS
            ) {
              console.log(
                `[clearOldTemporaryScanData] Clearing expired data for key: ${key}`
              );
              localStorage.removeItem(key);
            }
          } catch (e) {
            // If parsing fails, it might be old data without a timestamp.
            // Decide on a policy: remove it or leave it. Removing is safer.
            console.warn(
              `[clearOldTemporaryScanData] Removing un-parsable or legacy temp data for key: ${key}`
            );
            localStorage.removeItem(key);
          }
        }
      }
    }
  } catch (error) {
    console.error(
      "[clearOldTemporaryScanData] Error clearing old temporary data:",
      error
    );
  }
}

export async function getInvoicesService(userId: string): Promise<Invoice[]> {
  if (!db || !userId) return [];
  const invoicesRef = getUserSubcollectionRef<Invoice>(
    userId,
    DOCUMENTS_SUBCOLLECTION
  );
  const q = query(invoicesRef, orderBy("invoiceDate", "desc"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...(data as Invoice),
      id: doc.id,
      userId,
      invoiceDate: data.invoiceDate?.toDate
        ? data.invoiceDate.toDate().toISOString()
        : data.invoiceDate,
      dueDate: data.dueDate?.toDate
        ? data.dueDate.toDate().toISOString()
        : data.dueDate,
      paymentDate: data.paymentDate?.toDate
        ? data.paymentDate.toDate().toISOString()
        : data.paymentDate,
    };
  });
}

export async function updateInvoiceService(
  invoiceId: string,
  invoiceData: Partial<Invoice>,
  userId: string
): Promise<Invoice> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const invoiceRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );

  const dataToUpdate: any = { ...invoiceData };

  if (dataToUpdate.invoiceDate) {
    dataToUpdate.invoiceDate = Timestamp.fromDate(
      new Date(dataToUpdate.invoiceDate as any)
    );
  }
  if (dataToUpdate.paymentDate) {
    dataToUpdate.paymentDate = Timestamp.fromDate(
      new Date(dataToUpdate.paymentDate as any)
    );
  }
  if (dataToUpdate.dueDate) {
    dataToUpdate.dueDate = Timestamp.fromDate(
      new Date(dataToUpdate.dueDate as any)
    );
  }

  dataToUpdate.lastUpdated = serverTimestamp();

  await updateDoc(invoiceRef, dataToUpdate);

  const updatedDoc = await getDoc(invoiceRef);
  const updatedData = await updatedDoc.data();

  return {
    ...(updatedData as Invoice),
    id: updatedDoc.id,
    userId,
  };
}

export async function deleteInvoiceService(
  invoiceId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) {
    throw new Error("Firestore not initialized or user not authenticated.");
  }
  const docRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  await deleteDoc(docRef);
}

export async function updateInvoicePaymentStatusService(
  invoiceId: string,
  paymentStatus: Invoice["paymentStatus"],
  userId: string,
  paymentReceiptImageUri?: string | null
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const invoiceRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );

  const dataToUpdate: {
    paymentStatus: Invoice["paymentStatus"];
    paymentDate?: FieldValue;
    // paymentReceiptImageUri will be added conditionally
    [key: string]: any;
  } = {
    paymentStatus,
  };

  if (paymentStatus === "paid") {
    dataToUpdate.paymentDate = serverTimestamp();
    if (paymentReceiptImageUri) {
      dataToUpdate.paymentReceiptImageUri = paymentReceiptImageUri;
    }
  }

  await updateDoc(invoiceRef, dataToUpdate);
}

// SUPPLIERS
// -----------------------------------------------------------------

export async function getSuppliersService(userId: string): Promise<Supplier[]> {
  if (!db || !userId) return [];
  const suppliersRef = getUserSubcollectionRef<Supplier>(
    userId,
    SUPPLIERS_SUBCOLLECTION
  );
  const q = query(suppliersRef, orderBy("name"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    ...(doc.data() as Supplier),
    id: doc.id,
    userId,
  }));
}

export async function createSupplierService(
  name: string,
  contactInfo: { phone?: string; email?: string; paymentTerms?: string },
  userId: string
): Promise<Supplier> {
  if (!db || !userId) {
    throw new Error("Firestore not initialized or user not authenticated.");
  }
  const normalizedName = name.trim();
  const suppliersRef = getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION);

  const q = query(suppliersRef, where("name", "==", normalizedName));
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error("A supplier with this name already exists.");
  }

  const newSupplierData = {
    name: normalizedName,
    phone: contactInfo.phone || null,
    email: contactInfo.email || null,
    paymentTerms: contactInfo.paymentTerms || null,
    invoiceCount: 0,
    totalSpent: 0,
    lastActivityDate: serverTimestamp(),
    createdAt: serverTimestamp(),
    caspitAccountId: null,
  };

  const docRef = await addDoc(suppliersRef as any, newSupplierData);

  return {
    ...(newSupplierData as any),
    id: docRef.id,
    userId: userId,
  };
}

export async function updateSupplierService(
  supplierId: string,
  contactInfo: {
    phone?: string | null;
    email?: string | null;
    paymentTerms?: string | null;
  },
  userId: string
): Promise<void> {
  if (!db || !userId || !supplierId) {
    throw new Error("Missing required parameters for update.");
  }
  const docRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );

  const dataToUpdate = {
    ...contactInfo,
    lastActivityDate: serverTimestamp(),
  };

  await updateDoc(docRef as any, dataToUpdate);
}

export async function deleteSupplierService(
  supplierId: string,
  userId: string
): Promise<void> {
  if (!db || !userId) {
    throw new Error("Firestore not initialized or user not authenticated.");
  }

  const docRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );

  await deleteDoc(docRef as any);
}

// OTHER EXPENSES
// -----------------------------------------------------------------

export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  if (!db || !userId) return [];
  const expensesRef = getUserSubcollectionRef<OtherExpense>(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION
  );
  const q = query(expensesRef, orderBy("date", "desc"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...(data as OtherExpense),
      id: doc.id,
      userId,
      date: data.date?.toDate ? data.date.toDate().toISOString() : data.date,
      paymentDate: data.paymentDate?.toDate
        ? data.paymentDate.toDate().toISOString()
        : data.paymentDate,
    };
  });
}

export async function updateOtherExpenseService(
  expenseId: string,
  expenseData: Partial<OtherExpense>,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");
  const expenseRef = getUserSubcollectionDocRef(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION,
    expenseId
  );

  const dataToUpdate: any = { ...expenseData };

  if (dataToUpdate.date) {
    dataToUpdate.date = Timestamp.fromDate(new Date(dataToUpdate.date as any));
  }
  if (dataToUpdate.paymentDate) {
    dataToUpdate.paymentDate = Timestamp.fromDate(
      new Date(dataToUpdate.paymentDate as any)
    );
  }

  await updateDoc(expenseRef, dataToUpdate);
}

// EXPENSE CATEGORIES
// -----------------------------------------------------------------

export async function getExpenseCategoriesService(
  userId: string
): Promise<ExpenseCategory[]> {
  if (!db || !userId) return [];
  const categoriesRef = getUserSubcollectionRef<ExpenseCategory>(
    userId,
    EXPENSE_CATEGORIES_SUBCOLLECTION
  );
  const q = query(categoriesRef, orderBy("name"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(
    (doc) =>
      ({
        ...doc.data(),
        id: doc.id,
        userId,
      } as ExpenseCategory)
  );
}
