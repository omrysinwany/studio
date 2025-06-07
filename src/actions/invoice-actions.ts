"use server";

import { type Product, type InvoiceHistoryItem } from "@/services/types";
import {
  getUserSettingsService,
  updateProductService,
  productDoc,
  documentsCol,
  documentDoc,
} from "@/services/backend-server";
import {
  createOrUpdateCaspitSupplierAction,
  createOrUpdateCaspitProductAction,
  createCaspitPurchaseDocumentAction,
} from "@/actions/caspit-actions";
import { db } from "@/lib/firebase";
import { adminDb } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import {
  Timestamp,
  serverTimestamp,
  writeBatch,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { convertToTimestampIfValid } from "@/services/backend-server";

export async function finalizeAndSaveInvoice(
  productsFromDoc: Partial<Product>[],
  originalFileNameFromUpload: string,
  documentType: "deliveryNote" | "invoice" | "paymentReceipt",
  userId: string,
  tempInvoiceId?: string | null,
  extractedInvoiceNumber?: string | null,
  finalSupplierName?: string | null,
  extractedTotalAmount?: number | null,
  paymentDueDate?: string | Date | Timestamp | null,
  invoiceDate?: string | Date | Timestamp | null,
  paymentMethod?: string | null,
  originalImagePreviewDataUri?: string | null,
  compressedImageForFinalRecordDataUri?: string | null,
  rawScanResultJson?: string | null,
  paymentTermString?: string | null
): Promise<{
  finalInvoiceRecord: InvoiceHistoryItem;
  savedProductsWithFinalIds: Product[];
}> {
  if (!userId || !db) throw new Error("User ID or DB is not available.");

  const userSettings = await getUserSettingsService(userId);
  const posConfig = userSettings.posConnection;
  let caspitSupplierId: string | null = null;
  let caspitPurchaseDocId: string | null = null;
  const savedProductsWithFinalIds: Product[] = [];

  // First, save products to Firestore to get their final IDs
  const batch = writeBatch(db);
  for (const productData of productsFromDoc) {
    if (!productData.name) continue; // Name is mandatory

    const productId =
      productData.barcode ||
      `manual_${productData.name!.toLowerCase().replace(/\s+/g, "_")}`;
    const productRef = productDoc(userId, productId);

    const newProductData: Omit<Product, "id"> = {
      userId,
      name: productData.name,
      barcode: productData.barcode ?? null,
      price: productData.price ?? 0,
      cost: productData.cost ?? 0,
      quantity: productData.quantity ?? 0,
      stock: (productData.stock ?? 0) + (productData.quantity ?? 0),
      supplier: finalSupplierName ?? "N/A",
      category: productData.category ?? "כללי",
      lastPurchasedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      imageUrl: productData.imageUrl ?? null,
      status: "active",
    };

    batch.set(productRef, newProductData, { merge: true });
    savedProductsWithFinalIds.push({ ...newProductData, id: productId });
  }
  await batch.commit(); // Commit to save products and get their state

  // --- POS Integration: START ---
  if (
    posConfig &&
    posConfig.type === "caspit" &&
    (documentType === "invoice" || documentType === "deliveryNote")
  ) {
    try {
      if (finalSupplierName) {
        const supplierResult = await createOrUpdateCaspitSupplierAction(
          posConfig,
          {
            id: finalSupplierName,
            name: finalSupplierName,
            paymentTerms: paymentTermString,
          }
        );
        if (supplierResult.success && supplierResult.caspitAccountId) {
          caspitSupplierId = supplierResult.caspitAccountId;
        } else {
          console.error(
            "Failed to sync supplier with Caspit:",
            supplierResult.message
          );
        }
      }

      const caspitDocItems = [];
      for (const product of savedProductsWithFinalIds) {
        const productSyncResult = await createOrUpdateCaspitProductAction(
          posConfig,
          {
            id: product.id,
            name: product.name,
            sku: product.barcode || product.id,
            price: product.price,
            cost: product.cost ?? 0,
            stock: product.stock ?? 0,
            caspitProductId: product.caspitId,
          }
        );
        if (productSyncResult.success && productSyncResult.caspitProductId) {
          if (product.caspitId !== productSyncResult.caspitProductId) {
            await updateProductService(
              product.id,
              { caspitId: productSyncResult.caspitProductId },
              userId
            );
          }
          caspitDocItems.push({
            caspitProductId: productSyncResult.caspitProductId,
            quantity: product.quantity,
            price: product.cost ?? 0,
            name: product.name,
          });
        }
      }

      if (caspitSupplierId && caspitDocItems.length > 0) {
        const docDate = invoiceDate
          ? new Date(invoiceDate.toString()).toISOString()
          : new Date().toISOString();
        const docResult = await createCaspitPurchaseDocumentAction(posConfig, {
          supplierCaspitId: caspitSupplierId,
          documentNumber: extractedInvoiceNumber,
          date: docDate,
          items: caspitDocItems,
        });

        if (docResult.success && docResult.caspitDocumentId) {
          caspitPurchaseDocId = docResult.caspitDocumentId;
        } else {
          console.error(
            "Failed to create purchase document in Caspit:",
            docResult.message
          );
        }
      }
    } catch (e: any) {
      console.error(
        "An error occurred during POS synchronization:",
        e.message,
        e
      );
    }
  }
  // --- POS Integration: END ---

  const finalBatch = writeBatch(db);
  const newDocRef = tempInvoiceId
    ? documentDoc(userId, tempInvoiceId)
    : doc(documentsCol(userId));

  const finalInvoiceRecord: Omit<InvoiceHistoryItem, "id"> = {
    userId,
    originalFileName: originalFileNameFromUpload,
    status:
      finalSupplierName && documentType === "invoice" ? "pending" : "completed",
    totalAmount: extractedTotalAmount ?? 0,
    supplier: finalSupplierName ?? "N/A",
    invoiceDate: convertToTimestampIfValid(invoiceDate),
    paymentDueDate: convertToTimestampIfValid(paymentDueDate),
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    documentType: documentType,
    invoiceNumber: extractedInvoiceNumber,
    itemCount: productsFromDoc.length,
    products: savedProductsWithFinalIds.map((p) => p.id),
    paymentMethod: paymentMethod ?? null,
    paymentStatus: "unpaid",
    paymentDate: null,
    isArchived: false,
    originalImageUri: null,
    compressedImageUri: null,
    rawScanResultJson: rawScanResultJson ?? null,
    paymentReceiptImageUri: null,
    caspitPurchaseDocId: caspitPurchaseDocId,
  };

  finalBatch.set(newDocRef, finalInvoiceRecord, { merge: true });
  await finalBatch.commit();

  if (
    originalImagePreviewDataUri &&
    compressedImageForFinalRecordDataUri &&
    adminDb
  ) {
    const bucket = getStorage().bucket();
    const docId = newDocRef.id;

    const uploadImage = async (dataUri: string, path: string) => {
      const mimeType = dataUri.match(/data:(.*);base64,/)?.[1];
      const base64Data = dataUri.split(",")[1];
      if (!mimeType || !base64Data) return null;
      const buffer = Buffer.from(base64Data, "base64");
      const file = bucket.file(path);
      await file.save(buffer, { metadata: { contentType: mimeType } });
      return file.publicUrl();
    };

    const [originalImageUri, compressedImageUri] = await Promise.all([
      uploadImage(
        originalImagePreviewDataUri,
        `users/${userId}/documents/${docId}/original.jpg`
      ),
      uploadImage(
        compressedImageForFinalRecordDataUri,
        `users/${userId}/documents/${docId}/compressed.jpg`
      ),
    ]);

    await updateDoc(newDocRef, { originalImageUri, compressedImageUri });
  }

  const savedInvoiceDoc = await getDoc(newDocRef);
  if (!savedInvoiceDoc.exists()) {
    throw new Error("Failed to save the invoice document correctly.");
  }
  const finalData = {
    id: savedInvoiceDoc.id,
    ...savedInvoiceDoc.data(),
  } as InvoiceHistoryItem;

  return {
    finalInvoiceRecord: finalData,
    savedProductsWithFinalIds,
  };
}
