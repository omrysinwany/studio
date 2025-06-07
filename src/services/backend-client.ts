// src/services/backend-client.ts
"use client";

// localStorage keys
export const KPI_PREFERENCES_STORAGE_KEY_BASE = "invoTrack_kpiPreferences_v2";
export const QUICK_ACTIONS_PREFERENCES_STORAGE_KEY_BASE =
  "invoTrack_quickActionsPreferences_v1";
export const TEMP_DATA_KEY_PREFIX = "invoTrackTempScanData_";

export const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(
      `[getStorageKey] Called for baseKey "${baseKey}" without a userId.`
    );
    return `${baseKey}_SHARED_OR_NO_USER`;
  }
  return `${baseKey}_${userId}`;
};

export function clearTemporaryScanData(uniqueScanId?: string, userId?: string) {
  if (typeof window === "undefined" || !userId) return;
  if (!uniqueScanId) {
    console.warn(
      "[Backend - clearTemporaryScanData] Called without uniqueScanId for user:",
      userId
    );
    return;
  }
  try {
    const dataKey = getStorageKey(
      TEMP_DATA_KEY_PREFIX,
      `${userId}_${uniqueScanId}`
    );
    localStorage.removeItem(dataKey);
    console.log(
      `[Backend - clearTemporaryScanData] Cleared localStorage scan result (JSON) for key: ${dataKey}`
    );
  } catch (error) {
    console.error(
      `[Backend] Error removing temp localStorage key for UserID: ${userId}, ScanID: ${uniqueScanId}`,
      error
    );
  }
}

export function clearOldTemporaryScanData(
  emergencyClear: boolean = false,
  userIdToClear?: string
) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const EXPIRY_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  let itemsCleared = 0;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TEMP_DATA_KEY_PREFIX)) {
      if (userIdToClear && !key.includes(`_${userIdToClear}_`)) {
        continue;
      }
      const parts = key.split("_");
      const timestampString = parts.find((part) => /^\d{13,}$/.test(part));
      const timestamp = timestampString ? parseInt(timestampString, 10) : null;

      if (
        emergencyClear &&
        (userIdToClear || !key.includes("_SHARED_OR_NO_USER_"))
      ) {
        keysToRemove.push(key);
      } else if (
        timestamp &&
        !isNaN(timestamp) &&
        now - timestamp > EXPIRY_DURATION_MS
      ) {
        keysToRemove.push(key);
      }
    }
  }
  keysToRemove.forEach((key) => {
    try {
      localStorage.removeItem(key);
      itemsCleared++;
    } catch (e) {
      console.error(`[Backend] Error removing key ${key}:`, e);
    }
  });
  if (itemsCleared > 0)
    console.log(
      `[Backend] Cleared ${itemsCleared} old/emergency temp scan JSON items from localStorage (User: ${
        userIdToClear || "All Relevant"
      }).`
    );
}
