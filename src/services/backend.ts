import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  DocumentSnapshot,
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
  DocumentReference,
  CollectionReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createOrUpdateCaspitProductAction,
  deactivateCaspitProductAction,
  createOrUpdateCaspitContactAction,
  createCaspitDocumentAction,
  createCaspitExpenseAction,
  updateCaspitProductAction,
} from "@/actions/caspit-actions";
import type { PosConnectionConfig } from "./pos-integration/pos-adapter.interface";
import { parseISO, isValid } from "date-fns";
import type {
  Product,
  InvoiceHistoryItem,
  PriceCheckResult,
  ProductPriceDiscrepancy,
  Supplier,
  UserSettings,
  User,
  Invoice,
  OtherExpense,
  ExpenseCategory,
} from "./types";

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
// SUBCOLLECTION HELPERS
// =================================================================

const getUserSubcollectionRef = (userId: string, collectionName: string) => {
  if (!db) throw new Error("Firestore is not initialized.");
  if (!userId) throw new Error("User ID is required to access subcollections.");
  return collection(db, USERS_COLLECTION, userId, collectionName);
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

const convertToTimestampIfValid = (
  dateVal: any
): Timestamp | null | FieldValue => {
  if (!dateVal) return null;
  if (dateVal instanceof Date && isValid(dateVal)) {
    return Timestamp.fromDate(dateVal);
  }
  if (dateVal instanceof Timestamp) {
    return dateVal;
  }
  if (typeof dateVal === "string") {
    // Handle DD/MM/YYYY format which is common in some locales
    const dmyParts = dateVal.split("/");
    if (dmyParts.length === 3) {
      const day = parseInt(dmyParts[0], 10);
      const month = parseInt(dmyParts[1], 10);
      const year = parseInt(dmyParts[2], 10);
      // Note: month is 0-indexed in JavaScript Date constructor
      if (!isNaN(day) && !isNaN(month) && !isNaN(year) && year > 1000) {
        const parsedDmy = new Date(Date.UTC(year, month - 1, day));
        if (isValid(parsedDmy)) {
          return Timestamp.fromDate(parsedDmy);
        }
      }
    }

    // Fallback to ISO parsing
    const parsedIso = parseISO(dateVal);
    if (isValid(parsedIso)) {
      return Timestamp.fromDate(parsedIso);
    }
  }
  if (
    typeof dateVal === "object" &&
    dateVal !== null &&
    "isEqual" in dateVal &&
    typeof dateVal.isEqual === "function"
  ) {
    // This checks for FieldValue like serverTimestamp()
    return dateVal as FieldValue;
  }
  console.warn(
    `[convertToTimestampIfValid] Could not convert date value:`,
    dateVal
  );
  return null;
};

export const checkProductPricesBeforeSaveService = async (
  productsToCheck: Product[],
  userId: string
): Promise<PriceCheckResult> => {
  const inventoryRef = getUserSubcollectionRef(userId, INVENTORY_SUBCOLLECTION);
  const priceDiscrepancies: ProductPriceDiscrepancy[] = [];
  const productsToSaveDirectly: Product[] = [];

  const catalogNumbers = productsToCheck
    .map((p) => p.catalogNumber)
    .filter((cn): cn is string => !!cn);
  const barcodes = productsToCheck
    .map((p) => p.barcode)
    .filter((b): b is string => !!b);

  if (catalogNumbers.length === 0 && barcodes.length === 0) {
    return { productsToSaveDirectly: productsToCheck, priceDiscrepancies: [] };
  }

  const existingProductsMap = new Map<string, Product>();

  // Helper to add product to map
  const addProductToMap = (product: Product) => {
    if (
      product.catalogNumber &&
      !existingProductsMap.has(product.catalogNumber)
    ) {
      existingProductsMap.set(product.catalogNumber, product);
    }
    if (product.barcode && !existingProductsMap.has(product.barcode)) {
      existingProductsMap.set(product.barcode, product);
    }
  };

  const fetchInChunks = async (
    field: "catalogNumber" | "barcode",
    values: string[]
  ) => {
    for (let i = 0; i < values.length; i += 10) {
      const chunk = values.slice(i, i + 10);
      const q = query(inventoryRef, where(field, "in", chunk));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc) => {
        addProductToMap(doc.data() as Product);
      });
    }
  };

  if (catalogNumbers.length > 0) {
    await fetchInChunks("catalogNumber", catalogNumbers);
  }
  if (barcodes.length > 0) {
    await fetchInChunks("barcode", barcodes);
  }

  for (const product of productsToCheck) {
    const existingProduct =
      existingProductsMap.get(product.catalogNumber) ||
      existingProductsMap.get(product.barcode!);

    if (existingProduct) {
      const existingUnitPrice = Number(existingProduct.unitPrice) || 0;
      const newUnitPrice = Number(product.unitPrice) || 0;

      if (Math.abs(existingUnitPrice - newUnitPrice) > 0.001) {
        priceDiscrepancies.push({
          ...product,
          id: existingProduct.id,
          existingUnitPrice: existingUnitPrice,
          newUnitPrice: newUnitPrice,
        });
      } else {
        productsToSaveDirectly.push({
          ...product,
          id: existingProduct.id,
        });
      }
    } else {
      productsToSaveDirectly.push(product);
    }
  }

  return { productsToSaveDirectly, priceDiscrepancies };
};

export const finalizeSaveProductsService = async (
  productsToSave: (Omit<Product, "id" | "userId"> & {
    id?: string;
    _originalId?: string;
  })[],
  originalFileName: string,
  docType:
    | "deliveryNote"
    | "invoice"
    | "paymentReceipt"
    | "invoiceReceipt"
    | "receipt",
  userId: string,
  tempOrExistingDocId: string | null,
  invoiceNumber: string | null | undefined,
  supplierName: string | null | undefined,
  totalAmount: number | null | undefined,
  paymentDueDate: any,
  invoiceDate: any,
  paymentMethod: string | null | undefined,
  originalImagePreviewUri: string | null | undefined,
  compressedImageForFinalRecordUri: string | null | undefined,
  rawScanResultJson: string | null | undefined,
  paymentTermStringForDocument: string | undefined
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedOrUpdatedProducts: Product[];
}> => {
  const firestoreDb = db;
  if (!firestoreDb) throw new Error("Firestore (db) is not initialized.");
  if (!userId) throw new Error("User ID is missing.");
  if (!supplierName) throw new Error("Supplier name is required.");

  let finalInvoiceRecord!: InvoiceHistoryItem;
  const savedOrUpdatedProducts: Product[] = [];
  let finalSupplierId!: string;

  try {
    // --- Start of Critical Operations ---
    const supplierQuery = query(
      getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION),
      where("name", "==", supplierName),
      limit(1)
    );
    const supplierQuerySnapshot = await getDocs(supplierQuery);
    const existingSupplierDoc = supplierQuerySnapshot.docs[0];

    await runTransaction(firestoreDb, async (transaction) => {
      const inventoryCollectionRef = getUserSubcollectionRef(
        userId,
        INVENTORY_SUBCOLLECTION
      );
      let supplierRef: DocumentReference;

      if (existingSupplierDoc) {
        supplierRef = existingSupplierDoc.ref;
        finalSupplierId = existingSupplierDoc.id;
        const supplierDocInTransaction = await transaction.get(supplierRef);
        if (!supplierDocInTransaction.exists()) {
          throw new Error(
            "Supplier was deleted between the initial query and the transaction start."
          );
        }
        const supplierData = supplierDocInTransaction.data();
        transaction.update(supplierRef, {
          totalSpent: (supplierData.totalSpent || 0) + (totalAmount || 0),
          invoiceCount: (supplierData.invoiceCount || 0) + 1,
          lastActivityDate: serverTimestamp(),
        });
      } else {
        supplierRef = doc(
          getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION)
        );
        finalSupplierId = supplierRef.id;
        transaction.set(supplierRef, {
          id: finalSupplierId,
          userId,
          name: supplierName,
          totalSpent: totalAmount || 0,
          invoiceCount: 1,
          createdAt: serverTimestamp(),
          lastActivityDate: serverTimestamp(),
          paymentTerms: paymentTermStringForDocument || null,
          caspitAccountId: null,
        });
      }

      for (const product of productsToSave) {
        let productRef: DocumentReference;
        const { _originalId, ...productData } = product;

        if (_originalId && !_originalId.startsWith("prod-temp-")) {
          productRef = getUserSubcollectionDocRef(
            userId,
            INVENTORY_SUBCOLLECTION,
            _originalId
          );
          transaction.update(productRef, {
            ...productData,
            lastUpdated: serverTimestamp(),
            isActive: true,
          });
          const { lastUpdated, ...productDataForInvoice } =
            productData as Partial<Product>;
          savedOrUpdatedProducts.push({
            ...productDataForInvoice,
            id: _originalId,
            userId,
          } as Product);
        } else {
          productRef = doc(inventoryCollectionRef);
          const newProductData = {
            ...productData,
            id: productRef.id,
            userId,
            lastUpdated: serverTimestamp(),
            isActive: true,
          };
          transaction.set(productRef, newProductData);
          const { lastUpdated, ...newProductForInvoice } = newProductData;
          savedOrUpdatedProducts.push(newProductForInvoice as Product);
        }
      }

      const finalInvoiceRef = tempOrExistingDocId
        ? getUserSubcollectionDocRef(
            userId,
            DOCUMENTS_SUBCOLLECTION,
            tempOrExistingDocId
          )
        : doc(getUserSubcollectionRef(userId, DOCUMENTS_SUBCOLLECTION));

      const invoiceData = {
        id: finalInvoiceRef.id,
        userId,
        originalFileName,
        generatedFileName: `${docType}_${invoiceNumber || "N_A"}_${Date.now()}`,
        uploadTime: serverTimestamp(),
        status: "completed",
        documentType: docType,
        supplierName: supplierName,
        supplierId: finalSupplierId,
        invoiceNumber: invoiceNumber || null,
        invoiceDate: convertToTimestampIfValid(invoiceDate),
        totalAmount: totalAmount ?? 0,
        itemCount: productsToSave.length,
        paymentMethod: paymentMethod || null,
        dueDate: convertToTimestampIfValid(paymentDueDate),
        paymentStatus: "unpaid",
        products: savedOrUpdatedProducts,
        isArchived: false,
        rawScanResultJson: rawScanResultJson || null,
        caspitDocId: null,
        isSyncedToPos: false,
        syncError: null,
        paymentReceiptImageUri: null,
        originalImagePreviewUri: originalImagePreviewUri || null,
        compressedImageForFinalRecordUri:
          compressedImageForFinalRecordUri || null,
        errorMessage: null,
        linkedDeliveryNoteId: null,
        paymentTerms: paymentTermStringForDocument,
      };

      transaction.set(finalInvoiceRef, invoiceData, { merge: true });
      finalInvoiceRecord = invoiceData as unknown as InvoiceHistoryItem;
    });
    // --- End of Critical Operations ---

    // --- Start of Non-Critical POS Sync ---
    try {
      const userSettings = await getUserSettingsService(userId);
      if (
        userSettings?.posSystemId === "caspit" &&
        userSettings.posConfig &&
        finalSupplierId
      ) {
        const supplierDocRef = getUserSubcollectionDocRef(
          userId,
          SUPPLIERS_SUBCOLLECTION,
          finalSupplierId
        );
        const invoiceDocRef = getUserSubcollectionDocRef(
          userId,
          DOCUMENTS_SUBCOLLECTION,
          finalInvoiceRecord.id
        );
        const supplierDoc = await getDoc(supplierDocRef);

        if (supplierDoc.exists()) {
          const supplierData = supplierDoc.data() as Supplier;
          let caspitContactId = supplierData.caspitAccountId;

          if (!caspitContactId) {
            const contactResult = await createOrUpdateCaspitContactAction(
              userSettings.posConfig,
              supplierData
            );
            if (contactResult.success && contactResult.caspitAccountId) {
              caspitContactId = contactResult.caspitAccountId;
              await updateDoc(supplierDocRef, {
                caspitAccountId: caspitContactId,
              });
            } else {
              throw new Error(
                `Caspit supplier sync failed: ${contactResult.message}`
              );
            }
          }

          if (caspitContactId) {
            for (const product of savedOrUpdatedProducts) {
              const pResult = await createOrUpdateCaspitProductAction(
                userSettings.posConfig,
                product
              );
              if (pResult.success && pResult.caspitProductId && product.id) {
                await updateDoc(
                  getUserSubcollectionDocRef(
                    userId,
                    INVENTORY_SUBCOLLECTION,
                    product.id
                  ),
                  {
                    caspitProductId: pResult.caspitProductId,
                  }
                );
              }
            }

            if (
              docType === "invoice" ||
              docType === "invoiceReceipt" ||
              docType === "receipt"
            ) {
              const expenseResult = await createCaspitExpenseAction(
                userSettings.posConfig,
                JSON.parse(JSON.stringify(finalInvoiceRecord)),
                caspitContactId
              );
              if (expenseResult.success && expenseResult.caspitExpenseId) {
                await updateDoc(invoiceDocRef, {
                  caspitDocId: expenseResult.caspitExpenseId,
                  isSyncedToPos: true,
                  syncError: null,
                });
              } else {
                throw new Error(
                  `Caspit expense creation failed: ${expenseResult.message}`
                );
              }
            } else {
              await updateDoc(invoiceDocRef, {
                isSyncedToPos: true,
                syncError: null,
              });
            }
          }
        }
      }
    } catch (caspitError: any) {
      console.error(
        "[Backend] Non-blocking error during Caspit sync:",
        caspitError
      );
      if (finalInvoiceRecord?.id) {
        await updateDoc(
          getUserSubcollectionDocRef(
            userId,
            DOCUMENTS_SUBCOLLECTION,
            finalInvoiceRecord.id
          ),
          {
            syncError: `Caspit Sync Failed: ${caspitError.message}`,
          }
        );
      }
    }
    // --- End of Non-Critical POS Sync ---

    return { finalInvoiceRecord, savedOrUpdatedProducts };
  } catch (error) {
    console.error(
      "[Backend finalizeSaveProductsService] Critical Error:",
      error
    );
    throw error;
  }
};

export const syncProductsWithCaspitService = async (
  products: Product[],
  userId: string
): Promise<void> => {
  const userSettings = await getUserSettingsService(userId);
  if (userSettings?.posSystemId !== "caspit" || !userSettings.posConfig) {
    console.log("Caspit POS not configured, skipping sync.");
    return;
  }

  for (const product of products) {
    try {
      await createOrUpdateCaspitProductAction(userSettings.posConfig, product);
    } catch (error) {
      console.error(`Failed to sync product ${product.id} with Caspit:`, error);
    }
  }
};

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  const settingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );
  const docSnap = await getDoc(settingsRef);
  if (docSnap.exists()) {
    return docSnap.data() as UserSettings;
  }
  return {} as UserSettings; // Return empty object if no settings found
}

export async function saveUserSettingsService(
  settings: Partial<Omit<UserSettings, "userId">>,
  userId: string
): Promise<void> {
  const settingsRef = getUserSubcollectionDocRef(
    userId,
    USER_SETTINGS_SUBCOLLECTION,
    "userProfile"
  );
  await setDoc(settingsRef, settings, { merge: true });
}

export async function getProductsService(
  userId: string,
  options: { includeInactive?: boolean } = {}
): Promise<Product[]> {
  let q: Query = getUserSubcollectionRef(userId, INVENTORY_SUBCOLLECTION);
  if (!options.includeInactive) {
    q = query(q, where("isActive", "==", true));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as Product);
}

export async function getProductByIdService(
  productId: string,
  userId: string
): Promise<Product | null> {
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );
  const docSnap = await getDoc(productRef);
  return docSnap.exists() ? (docSnap.data() as Product) : null;
}

export async function updateProductService(
  productId: string,
  productData: Partial<Product>,
  userId: string
): Promise<void> {
  if (!db || !userId) throw new Error("DB not initialized or User ID missing.");

  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );

  const dataToUpdate = {
    ...productData,
    lastUpdated: serverTimestamp(),
  };

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists()) {
      throw new Error("Product not found for update.");
    }
    const productBeforeUpdate = {
      id: productDoc.id,
      userId,
      ...productDoc.data(),
    } as Product;

    await updateDoc(productRef, dataToUpdate);
    console.log(`[Backend] Product ${productId} updated in Firestore.`);

    if (productBeforeUpdate.caspitProductId) {
      const userSettings = await getUserSettingsService(userId);
      if (userSettings?.posSystemId === "caspit" && userSettings.posConfig) {
        console.log(
          `[Backend updateProductService] Attempting to update product in Caspit. Caspit ID: ${productBeforeUpdate.caspitProductId}`
        );
        const updatedProductForCaspit: Product = {
          ...productBeforeUpdate,
          ...dataToUpdate,
        } as Product;

        try {
          const caspitResult = await updateCaspitProductAction(
            userSettings.posConfig,
            updatedProductForCaspit
          );
          if (caspitResult.success) {
            console.log(
              `[Backend updateProductService] Successfully updated product ${productId} in Caspit.`
            );
          } else {
            console.error(
              `[Backend updateProductService] Failed to update product ${productId} in Caspit: ${caspitResult.message}`
            );
          }
        } catch (caspitError: any) {
          console.error(
            `[Backend updateProductService] Critical error during Caspit update for product ${productId}: `,
            caspitError.message
          );
        }
      }
    }
  } catch (error) {
    console.error(`[Backend] Error updating product ${productId}:`, error);
    throw error;
  }
}

export async function deleteProductService(
  productId: string,
  userId: string
): Promise<void> {
  const productRef = getUserSubcollectionDocRef(
    userId,
    INVENTORY_SUBCOLLECTION,
    productId
  );

  let productToDeactivate: Product | null = null;

  try {
    const productDoc = await getDoc(productRef);
    if (!productDoc.exists()) {
      throw new Error("Product not found for deactivation.");
    }
    productToDeactivate = {
      id: productDoc.id,
      userId,
      ...productDoc.data(),
    } as Product;

    await updateDoc(productRef, {
      isActive: false,
      lastUpdated: serverTimestamp(),
    });
    console.log(
      `[Backend] Product ${productId} marked as inactive in Firestore.`
    );

    if (productToDeactivate?.caspitProductId) {
      const userSettings = await getUserSettingsService(userId);
      if (userSettings?.posSystemId === "caspit" && userSettings.posConfig) {
        console.log(
          `[Backend deleteProductService] Attempting to deactivate product in Caspit. Caspit ID: ${productToDeactivate.caspitProductId}`
        );
        const caspitResult = await deactivateCaspitProductAction(
          userSettings.posConfig,
          productToDeactivate
        );
        if (caspitResult.success) {
          console.log(
            `[Backend deleteProductService] Product ${productId} also marked as inactive in Caspit.`
          );
        } else {
          console.error(
            `[Backend deleteProductService] Failed to mark product ${productId} as inactive in Caspit: ${caspitResult.message}`
          );
        }
      }
    }
  } catch (error) {
    console.error(`[Backend] Error deactivating product ${productId}:`, error);
    throw error;
  }
}

export async function reactivateProductService(
  productId: string,
  userId: string
): Promise<void> {
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
  if (!db) throw new Error("Firestore not initialized");
  const inventoryRef = getUserSubcollectionRef(userId, INVENTORY_SUBCOLLECTION);
  const snapshot = await getDocs(inventoryRef);
  const batch = writeBatch(db);
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
}

export function getStorageKey(baseKey: string, userId: string): string {
  return `${baseKey}:${userId}`;
}

export function clearTemporaryScanData(tempId: string, userId: string) {
  const key = getStorageKey(`${TEMP_DATA_KEY_PREFIX}${tempId}`, userId);
  localStorage.removeItem(key);
}

export function clearOldTemporaryScanData(
  force = false,
  currentUserId?: string
) {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(TEMP_DATA_KEY_PREFIX)) {
      if (force && currentUserId && key.endsWith(currentUserId)) {
        localStorage.removeItem(key);
        return;
      }
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const { timestamp } = JSON.parse(stored);
          if (Date.now() - timestamp > TEMP_DATA_EXPIRATION_MS) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        localStorage.removeItem(key);
      }
    }
  });
}

export async function getInvoicesService(
  userId: string
): Promise<InvoiceHistoryItem[]> {
  if (!db) throw new Error("Firestore not initialized");
  const invoicesRef = getUserSubcollectionRef(userId, DOCUMENTS_SUBCOLLECTION);
  const q = query(invoicesRef, orderBy("uploadTime", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as InvoiceHistoryItem);
}

export async function updateInvoiceService(
  invoiceId: string,
  invoiceData: Partial<Invoice>,
  userId: string
): Promise<Invoice> {
  const invoiceRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  await updateDoc(invoiceRef, invoiceData);
  const updatedDoc = await getDoc(invoiceRef);
  return updatedDoc.data() as Invoice;
}

export async function deleteInvoiceService(
  invoiceId: string,
  userId: string
): Promise<void> {
  const invoiceRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  await deleteDoc(invoiceRef);
}

export async function updateInvoicePaymentStatusService(
  invoiceId: string,
  paymentStatus: Invoice["paymentStatus"],
  userId: string,
  paymentReceiptImageUri?: string | null
): Promise<void> {
  const invoiceRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    invoiceId
  );
  const updateData: Partial<Invoice> = { paymentStatus };
  if (paymentStatus === "paid" && paymentReceiptImageUri !== undefined) {
    updateData.paymentReceiptImageUri = paymentReceiptImageUri;
  } else if (paymentStatus !== "paid") {
    updateData.paymentReceiptImageUri = "";
  }
  await updateDoc(invoiceRef, updateData);
}

export const archiveDocumentService = async (
  docId: string,
  userId: string
): Promise<void> => {
  const docRef = getUserSubcollectionDocRef(
    userId,
    DOCUMENTS_SUBCOLLECTION,
    docId
  );
  await updateDoc(docRef, {
    isArchived: true,
    lastUpdated: serverTimestamp(),
  });
};

export async function getSuppliersService(userId: string): Promise<Supplier[]> {
  if (!db) throw new Error("Firestore not initialized");
  const suppliersRef = getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION);
  const q = query(suppliersRef, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as Supplier);
}

export async function createSupplierAndSyncWithCaspitService(
  supplierData: Partial<Omit<Supplier, "id">>,
  userId: string
): Promise<Supplier> {
  const newSupplier = await createSupplierService(supplierData, userId);

  const userSettings = await getUserSettingsService(userId);
  if (userSettings?.posSystemId === "caspit" && userSettings.posConfig) {
    const result = await createOrUpdateCaspitContactAction(
      userSettings.posConfig,
      JSON.parse(JSON.stringify(newSupplier))
    );
    if (result.success && result.caspitAccountId) {
      const supplierRef = getUserSubcollectionDocRef(
        userId,
        SUPPLIERS_SUBCOLLECTION,
        newSupplier.id
      );
      await updateDoc(supplierRef, {
        caspitAccountId: result.caspitAccountId,
      });
      return { ...newSupplier, caspitAccountId: result.caspitAccountId };
    } else {
      console.error("Failed to sync new supplier with Caspit:", result.message);
    }
  }
  return newSupplier;
}

export async function createSupplierService(
  supplierData: Partial<Omit<Supplier, "id">>,
  userId: string
): Promise<Supplier> {
  if (!db) throw new Error("Database not initialized");
  if (!userId) throw new Error("User authentication is required");
  if (!supplierData.name) {
    throw new Error("Supplier name cannot be empty.");
  }

  const normalizedName = supplierData.name.trim();
  const q = query(
    getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION),
    where("name", "==", normalizedName)
  );
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error(`Supplier with name "${normalizedName}" already exists.`);
  }

  const newSupplierRef = doc(
    getUserSubcollectionRef(userId, SUPPLIERS_SUBCOLLECTION)
  );

  const newSupplierData = {
    ...supplierData,
    name: normalizedName,
    userId: userId,
    createdAt: serverTimestamp(),
    invoiceCount: 0,
    totalSpent: 0,
    caspitAccountId: supplierData.caspitAccountId || null,
  };

  await setDoc(newSupplierRef, newSupplierData);
  console.log(
    `[Backend] New supplier ${newSupplierRef.id} created for user ${userId}.`
  );

  const now = Timestamp.now();
  return {
    ...newSupplierData,
    id: newSupplierRef.id,
    createdAt: now,
    lastActivityDate: null,
  } as Supplier;
}

export async function updateSupplierService(
  supplierId: string,
  supplierData: Partial<Omit<Supplier, "id" | "userId">>,
  userId: string
): Promise<void> {
  const supplierRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );
  await updateDoc(supplierRef, supplierData);
}

export async function deleteSupplierService(
  supplierId: string,
  userId: string
): Promise<void> {
  const supplierRef = getUserSubcollectionDocRef(
    userId,
    SUPPLIERS_SUBCOLLECTION,
    supplierId
  );
  // Optional: Add logic to check for dependent documents before deleting
  await deleteDoc(supplierRef);
}

// ... other service functions (OtherExpense, ExpenseCategory, etc.)
export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  if (!db) throw new Error("Firestore not initialized");
  const expensesRef = getUserSubcollectionRef(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION
  );
  const q = query(expensesRef, orderBy("date", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as OtherExpense);
}

export async function updateOtherExpenseService(
  expenseId: string,
  expenseData: Partial<OtherExpense>,
  userId: string
): Promise<void> {
  const expenseRef = getUserSubcollectionDocRef(
    userId,
    OTHER_EXPENSES_SUBCOLLECTION,
    expenseId
  );
  await updateDoc(expenseRef, expenseData);
}

export async function getExpenseCategoriesService(
  userId: string
): Promise<ExpenseCategory[]> {
  if (!db) throw new Error("Firestore not initialized");
  const categoriesRef = getUserSubcollectionRef(
    userId,
    EXPENSE_CATEGORIES_SUBCOLLECTION
  );
  const q = query(categoriesRef, orderBy("name"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.data() as ExpenseCategory);
}

export const saveUserToFirestore = async (
  user: Pick<
    import("firebase/auth").User,
    "uid" | "email" | "displayName" | "metadata"
  >
): Promise<User> => {
  if (!db) throw new Error("Firestore not initialized");
  const userRef = doc(db, USERS_COLLECTION, user.uid);
  const data: Partial<User> = {
    email: user.email,
    username: user.displayName,
    lastLoginAt: serverTimestamp(),
  };

  const userDoc = await getDoc(userRef);
  if (!userDoc.exists()) {
    data.createdAt = serverTimestamp();
  }

  await setDoc(userRef, data, { merge: true });
  const finalUserDoc = await getDoc(userRef);
  return { id: finalUserDoc.id, ...finalUserDoc.data() } as User;
};
