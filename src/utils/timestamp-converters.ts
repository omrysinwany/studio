import { Timestamp as AdminTimestamp } from "firebase-admin/firestore";
import { Timestamp as ClientTimestamp, FieldValue } from "firebase/firestore";
import { parseISO, isValid } from "date-fns";

/**
 * Converts a Firestore Admin Timestamp or other date-like objects to a serialized ISO string.
 * Returns null if the input is null, undefined, or invalid.
 * @param field The Timestamp, Date, or string to convert.
 * @returns An ISO string or null.
 */
export const convertAdminTimestampToString = (
  field: AdminTimestamp | Date | string | null | undefined
): string | null => {
  if (!field) return null;
  if (typeof field === "string") return field;
  if (field instanceof Date) {
    return field.toISOString();
  }
  // Check for Firestore Timestamp-like object
  if (
    typeof field === "object" &&
    typeof (field as any).toDate === "function"
  ) {
    return (field as AdminTimestamp).toDate().toISOString();
  }
  return null;
};

type DateLike =
  | AdminTimestamp
  | ClientTimestamp
  | Date
  | string
  | FieldValue
  | null
  | undefined;

/**
 * Converts various date-like types to a Date object.
 * Handles Firestore Timestamps (admin and client), ISO strings, and Date objects.
 * Returns null for invalid or null inputs.
 * @param value The date-like value to convert.
 * @returns A Date object or null.
 */
export const normalizeToDate = (value: DateLike): Date | null => {
  if (!value) {
    return null;
  }

  // It's already a Date object
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }

  // It's a string, likely ISO
  if (typeof value === "string") {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
  }

  // It's a Firestore Timestamp-like object (both client and admin have toDate)
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as any).toDate === "function"
  ) {
    const date = (value as AdminTimestamp | ClientTimestamp).toDate();
    return isValid(date) ? date : null;
  }

  return null;
};
