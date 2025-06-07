"use server";

import { adminDb } from "@/lib/firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type {
  InvoiceHistoryItem,
  OtherExpense,
  UserSettings,
} from "@/services/types";
import {
  DOCUMENTS_COLLECTION,
  OTHER_EXPENSES_COLLECTION,
  USERS_COLLECTION,
  sanitizeForFirestore,
} from "@/services/backend-server";

// This function is copied from backend-server.ts to avoid circular dependencies
// A better solution would be to move it to a shared utils file.
const convertTimestampToString = (
  field: Timestamp | Date | string | null | undefined
): string | null => {
  if (!field) return null;
  if (typeof field === "string") return field;
  // The 'instanceof' checks need to be robust for both client and admin Timestamps.
  // The admin Timestamp has toDate(), the client one does too.
  if (
    field instanceof Date ||
    (typeof field === "object" && "toDate" in field)
  ) {
    // @ts-ignore
    return field.toDate().toISOString();
  }
  return null;
};

export async function getInvoicesService(
  userId: string
): Promise<InvoiceHistoryItem[]> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) throw new Error("User ID is required.");

  const invoicesRef = adminDb.collection(DOCUMENTS_COLLECTION);
  const q = invoicesRef
    .where("userId", "==", userId)
    .orderBy("uploadTime", "desc");
  const snapshot = await q.get();

  const invoices = snapshot.docs.map((doc) => {
    const data = doc.data();
    // Convert all timestamp fields to string for client-side serialization
    return {
      ...data,
      id: doc.id,
      uploadTime: convertTimestampToString(data.uploadTime),
      invoiceDate: convertTimestampToString(data.invoiceDate),
      paymentDueDate: convertTimestampToString(data.paymentDueDate),
    } as InvoiceHistoryItem;
  });

  return invoices;
}

export async function getUserSettingsService(
  userId: string
): Promise<UserSettings> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) {
    console.warn(
      "getUserSettingsService called without userId, returning defaults"
    );
    // Return a complete, default UserSettings object
    return Promise.resolve({
      reminderDaysBefore: 1,
      posConfig: null,
      accountant: null,
      monthlyBudget: 0,
      kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
      quickActionPreferences: {
        visibleQuickActionIds: [],
        quickActionOrder: [],
      },
    });
  }
  const userRef = adminDb.collection(USERS_COLLECTION).doc(userId);
  const docSnap = await userRef.get();

  if (docSnap.exists) {
    const data = docSnap.data();
    // Settings are nested within the user document
    return (data?.settings as UserSettings) || {};
  } else {
    // Return a default structure if no settings exist for the user
    return Promise.resolve({
      reminderDaysBefore: 1,
      posConfig: null,
      accountant: null,
      monthlyBudget: 0,
      kpiPreferences: { visibleKpiIds: [], kpiOrder: [] },
      quickActionPreferences: {
        visibleQuickActionIds: [],
        quickActionOrder: [],
      },
    });
  }
}

export async function saveUserSettingsService(
  settings: Partial<UserSettings>,
  userId: string
): Promise<void> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) throw new Error("User ID is required to save settings.");

  const userRef = adminDb.collection(USERS_COLLECTION).doc(userId);

  const sanitizedSettings = sanitizeForFirestore(settings);

  // Update the 'settings' field within the user document
  await userRef.set(
    {
      settings: {
        ...sanitizedSettings,
        lastUpdated: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

export async function getOtherExpensesService(
  userId: string
): Promise<OtherExpense[]> {
  if (!adminDb) throw new Error("Firestore Admin DB is not initialized.");
  if (!userId) throw new Error("User ID is required to fetch other expenses.");

  const expensesRef = adminDb.collection(OTHER_EXPENSES_COLLECTION);
  const q = expensesRef.where("userId", "==", userId).orderBy("date", "desc");
  const snapshot = await q.get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      date: convertTimestampToString(data.date),
    } as OtherExpense;
  });
}
