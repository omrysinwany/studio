"use server";

import "server-only";
import { PosConnectionConfig } from "@/services/pos-integration/pos-adapter.interface";
import type {
  CaspitDocument,
  CaspitContact,
} from "@/services/pos-integration/caspit-types";

const CASPIT_API_URL = "https://app.caspit.biz/api/v1";

interface CaspitToken {
  token: string;
  expires: string; // ISO 8601 date string
}

// A simple in-memory cache for tokens, keyed by user's osekMorshe
const tokenCache: Record<string, CaspitToken> = {};

/**
 * Retrieves an authentication token from the Caspit API using user-specific credentials.
 * It uses an in-memory cache to avoid requesting a new token for every call.
 *
 * @param {PosConnectionConfig} config - The user's POS connection configuration.
 * @returns {Promise<string>} The authentication token.
 * @throws {Error} If credentials are not set or if token fetching fails.
 */
async function getApiToken(config: PosConnectionConfig): Promise<string> {
  const cacheKey = config.osekMorshe;
  const cachedToken = tokenCache[cacheKey];

  // If we have a token in cache and it's not expired (giving a 1-minute buffer)
  if (
    cachedToken &&
    new Date(cachedToken.expires) > new Date(Date.now() - 60 * 1000)
  ) {
    return cachedToken.token;
  }

  if (!config.user || !config.pwd || !config.osekMorshe) {
    throw new Error(
      "Caspit API credentials (user, pwd, osekMorshe) are missing from the provided config."
    );
  }

  const url = `${CASPIT_API_URL}/Token?user=${encodeURIComponent(
    config.user
  )}&pwd=${encodeURIComponent(config.pwd)}&osekMorshe=${encodeURIComponent(
    config.osekMorshe
  )}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get Caspit token: ${response.statusText} - ${errorBody}`
      );
    }

    const tokenString = await response.text();
    const token = tokenString.replace(/"/g, "");

    const expiryDate = new Date(Date.now() + 9 * 60 * 1000);

    tokenCache[cacheKey] = {
      token: token,
      expires: expiryDate.toISOString(),
    };

    return tokenCache[cacheKey].token;
  } catch (error) {
    console.error("Error fetching Caspit API token:", error);
    delete tokenCache[cacheKey];
    throw error;
  }
}

/**
 * Finds a contact (supplier) in Caspit by their tax ID (Osek Morshe).
 *
 * @param {PosConnectionConfig} config - The user's POS connection configuration.
 * @param {string} taxId - The tax ID of the contact to find.
 * @returns {Promise<any | null>} The contact object if found, otherwise null.
 */
export async function findContactByTaxId(
  config: PosConnectionConfig,
  taxId: string
): Promise<any | null> {
  const token = await getApiToken(config);
  const url = `${CASPIT_API_URL}/Contacts?token=${token}&osekMorshe=${taxId}&d=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        console.log(`Contact with taxId ${taxId} not found in Caspit.`);
        return null;
      }
      const errorBody = await response.text();
      throw new Error(
        `Failed to get Caspit contact: ${response.statusText} - ${errorBody}`
      );
    }
    const contact = await response.json();
    return contact;
  } catch (error) {
    console.error(`Error finding contact with taxId ${taxId}:`, error);
    return null;
  }
}

/**
 * Creates a new contact (supplier) in Caspit.
 *
 * @param {PosConnectionConfig} config - The user's POS connection configuration.
 * @param {CaspitContact} contactData - The contact object to create.
 * @returns {Promise<any>} The created contact object from Caspit.
 * @throws {Error} If the contact creation fails.
 */
export async function createCaspitContact(
  config: PosConnectionConfig,
  contactData: CaspitContact
): Promise<any> {
  const token = await getApiToken(config);
  const url = `${CASPIT_API_URL}/Contacts?token=${token}`;

  console.log(
    "[CaspitAction] Creating contact with payload:",
    JSON.stringify(contactData, null, 2)
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Caspit-Token": token,
      },
      body: JSON.stringify(contactData),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[CaspitAction] Failed to create contact. Status: ${response.status}. Body: ${errorBody}`
      );
      throw new Error(
        `Failed to create Caspit contact: ${response.statusText} - ${errorBody}`
      );
    }

    const createdContact = await response.json();
    console.log("[CaspitAction] Successfully created contact:", createdContact);
    return createdContact;
  } catch (error) {
    console.error("[CaspitAction] Error creating Caspit contact:", error);
    throw error;
  }
}

/**
 * Gets the list of TrxCodes (Transaction Classifications) from Caspit.
 *
 * @param {PosConnectionConfig} config - The user's POS connection configuration.
 * @returns {Promise<any[]>} A list of TrxCode objects.
 * @throws {Error} If fetching the codes fails.
 */
export async function getTrxCodes(config: PosConnectionConfig): Promise<any[]> {
  const token = await getApiToken(config);
  const url = `${CASPIT_API_URL}/TrxCodes?token=${token}`;

  console.log("[CaspitAction] Getting TrxCodes from:", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get Caspit TrxCodes: ${response.statusText} - ${errorBody}`
      );
    }
    const trxCodes = await response.json();
    return trxCodes;
  } catch (error) {
    console.error("[CaspitAction] Error fetching TrxCodes:", error);
    throw error;
  }
}

/**
 * Creates a new document in Caspit.
 *
 * @param {PosConnectionConfig} config - The user's POS connection configuration.
 * @param {CaspitDocument} documentData - The document object to create.
 * @returns {Promise<any>} The response from the Caspit API after creating the document.
 * @throws {Error} If the document creation fails.
 */
export async function createCaspitDocument(
  config: PosConnectionConfig,
  documentData: CaspitDocument
): Promise<any> {
  const token = await getApiToken(config);
  const url = `${CASPIT_API_URL}/Documents?token=${token}`;

  console.log("[CaspitAction] Creating document. URL:", url);
  console.log(
    "[CaspitAction] Document Data Payload:",
    JSON.stringify(documentData, null, 2)
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Caspit-Token": token,
      },
      body: JSON.stringify(documentData),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `[CaspitAction] Failed to create document. Status: ${response.status}. Body: ${errorBody}`
      );
      throw new Error(
        `Failed to create Caspit document: ${response.statusText} - ${errorBody}`
      );
    }

    const createdDocument = await response.json();
    console.log(
      "[CaspitAction] Successfully created document:",
      createdDocument
    );
    return createdDocument;
  } catch (error) {
    console.error("[CaspitAction] Error creating Caspit document:", error);
    throw error;
  }
}
