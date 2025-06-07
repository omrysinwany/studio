import type { PosConnectionConfig } from "@/services/pos-integration/pos-adapter.interface";

const CASPIT_API_BASE_URL = "https://api.caspit.biz/api/v1";

interface CaspitToken {
  token: string;
  expires: string; // ISO 8601 date string
}

// A simple in-memory cache for tokens
const tokenCache: Record<string, CaspitToken> = {};

/**
 * Retrieves an authentication token from the Caspit API.
 * It uses an in-memory cache to avoid requesting a new token for every call.
 * This implementation assumes the token endpoint is at /token and uses apiKey/apiSecret from the config.
 *
 * @param {PosConnectionConfig} posConfig - The user's POS connection configuration.
 * @returns {Promise<string>} The authentication token.
 * @throws {Error} If credentials are not set or if token fetching fails.
 */
export async function getCaspitToken(
  posConfig: PosConnectionConfig
): Promise<string> {
  if (posConfig.type !== "caspit" || !posConfig.config) {
    throw new Error("Invalid POS configuration type for Caspit token request.");
  }

  const config = posConfig.config as {
    apiKey: string;
    apiSecret: string;
    businessId?: string;
  };
  const cacheKey = config.apiKey;
  const cachedToken = tokenCache[cacheKey];

  // If we have a token in cache and it's not expired (giving a 1-minute buffer)
  if (
    cachedToken &&
    new Date(cachedToken.expires) > new Date(Date.now() - 60 * 1000)
  ) {
    return cachedToken.token;
  }

  if (!config.apiKey || !config.apiSecret) {
    throw new Error(
      "Caspit API credentials (apiKey, apiSecret) are missing from the provided config."
    );
  }

  // This URL structure is an assumption. The endpoint for api.caspit.biz might be different.
  // Common patterns are /token, /Token, /auth.
  // The parameters (user, pwd, osekMorshe) are also based on another implementation in the project.
  const url = `${CASPIT_API_BASE_URL}/token?user=${encodeURIComponent(
    config.apiKey
  )}&pwd=${encodeURIComponent(
    config.apiSecret
  )}&osekmorshe=${encodeURIComponent(config.businessId || "")}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get Caspit token: ${response.statusText} - ${errorBody}`
      );
    }

    const tokenString = await response.text();
    // The token might be wrapped in quotes or XML, this handles simple quote wrapping.
    const token = tokenString.replace(/"/g, "");

    // Assume token is valid for ~10 minutes, cache for 9.
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
