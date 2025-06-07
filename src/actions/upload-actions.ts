"use server";

import { adminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { type InvoiceHistoryItem } from "@/services/types";
import {
  USERS_COLLECTION,
  DOCUMENTS_COLLECTION,
} from "@/services/backend-server";
import { parseISO, isValid } from "date-fns";

const convertToTimestamp = (dateVal: any): Timestamp | null => {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return Timestamp.fromDate(dateVal);
  if (typeof dateVal === "string") {
    const parsed = parseISO(dateVal);
    if (isValid(parsed)) return Timestamp.fromDate(parsed);
  }
  if (dateVal instanceof Timestamp) return dateVal;
  if (
    typeof dateVal === "object" &&
    dateVal.seconds !== undefined &&
    dateVal.nanoseconds !== undefined
  ) {
    return new Timestamp(dateVal.seconds, dateVal.nanoseconds);
  }
  // Attempt to parse dd/mm/yyyy format
  if (typeof dateVal === "string") {
    const parts = dateVal.split("/");
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const parsedDate = new Date(year, month, day);
        if (isValid(parsedDate)) {
          return Timestamp.fromDate(parsedDate);
        }
      }
    }
  }
  console.warn(
    `[createPendingDocumentAction] Could not convert date:`,
    dateVal
  );
  return null;
};

export async function createPendingDocumentAction(
  userId: string,
  docId: string,
  docData: Omit<
    InvoiceHistoryItem,
    "id" | "userId" | "createdAt" | "updatedAt" | "status" | "uploadedAt"
  >
): Promise<string> {
  if (!userId) {
    throw new Error("User ID is required.");
  }
  if (!docId) {
    throw new Error("Document ID is required.");
  }

  const docDataWithTimestamp = {
    ...docData,
    invoiceDate: convertToTimestamp(docData.invoiceDate),
  };

  const docRef = adminDb
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId);

  await docRef.set({
    ...docDataWithTimestamp,
    userId,
    status: "pending",
    uploadedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return docId;
}
