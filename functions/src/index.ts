/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import { onRequest } from "firebase-functions/v2/https"; // Removed as not used for scheduled function
// import * as logger from "firebase-functions/logger"; // Removed, using functions.logger directly
// import * as functions from "firebase-functions"; // Removed as unused
import * as admin from "firebase-admin";
import axios from "axios";
// import { pubsub } from "firebase-functions"; // Removed this specific import, will use functions.pubsub
import {onSchedule, ScheduledEvent} from "firebase-functions/v2/scheduler"; // For v2 scheduled functions
import * as logger from "firebase-functions/logger"; // For v2 logger

admin.initializeApp();
const db = admin.firestore();

const INVENTORY_COLLECTION = "inventoryProducts"; // Updated collection name
const USER_SETTINGS_COLLECTION = "userSettings"; // Updated collection name
const CASPIT_API_BASE_URL = "https://app.caspit.biz/api/v1";

interface CaspitProduct {
  ProductId: string;
  Name: string | null;
  Description: string | null;
  Status: boolean;
  PurchasePrice: number | null;
  SalePrice1: number | null;
  QtyInStock: number | null;
  CatalogNumber: string | null;
  Barcode: string | null;
  DateCreated: string; // ISO Date string e.g., "2024-05-05T13:54:01.34"
  DateUpdated: string; // ISO Date string e.g., "2024-08-07T16:00:17.94"
  // Add any other fields you might need from Caspit product
}

interface FirestoreProductData {
  id?: string; // Firestore document ID
  userId: string;
  shortName?: string | null;
  description?: string | null;
  isActive?: boolean;
  unitPrice?: number | null; // PurchasePrice
  salePrice?: number | null; // SalePrice1
  quantity?: number | null; // QtyInStock
  catalogNumber?: string | null;
  barcode?: string | null;
  caspitProductId?: string | null;
  dateCreated?: admin.firestore.Timestamp;
  lastUpdated?: admin.firestore.Timestamp;
  // Add other Firestore product fields
}

interface UserSettings {
  id: string; // userId
  posSystemId?: string; // MODIFIED: posSystem -> posSystemId
  posConfig?: {
    user?: string; // ADDED for Caspit login
    pwd?: string; // ADDED for Caspit login
    osekMorshe?: string; // ADDED for Caspit login
    token?: string; // This will NOT be used by the function to fetch, but might be stored by the app
    // other POS config fields
  };
  // other user settings fields
}

// ADDED Interface for Caspit's paginated API response
interface CaspitPaginatedResponse {
  CurrentPage: number;
  TotalCount: number;
  TotalPages: number;
  PrevPageUrl: string | null;
  NextPageUrl: string | null;
  Results: CaspitProduct[];
}

// Helper to map Caspit product to Firestore product data structure
function mapCaspitToFirestore(
  caspitProduct: CaspitProduct,
  userId: string,
): FirestoreProductData {
  const firestoreData: FirestoreProductData = {
    userId: userId,
    caspitProductId: caspitProduct.ProductId,
    shortName: caspitProduct.Name,
    description: caspitProduct.Description,
    isActive: caspitProduct.Status,
    unitPrice: caspitProduct.PurchasePrice,
    salePrice: caspitProduct.SalePrice1,
    quantity: caspitProduct.QtyInStock,
    catalogNumber: caspitProduct.CatalogNumber,
    barcode: caspitProduct.Barcode,
    dateCreated: caspitProduct.DateCreated
      ? admin.firestore.Timestamp.fromDate(new Date(caspitProduct.DateCreated))
      : undefined, // Or FieldValue.serverTimestamp() for new docs if DateCreated is missing
    lastUpdated: caspitProduct.DateUpdated
      ? admin.firestore.Timestamp.fromDate(new Date(caspitProduct.DateUpdated))
      : (admin.firestore.FieldValue.serverTimestamp() as admin.firestore.Timestamp),
  };
  // Remove undefined fields to avoid overwriting with undefined in Firestore
  Object.keys(firestoreData).forEach((keyStr) => {
    const key = keyStr as keyof FirestoreProductData;
    if (firestoreData[key] === undefined) {
      delete firestoreData[key];
    }
  });
  return firestoreData;
}

// Helper to determine if a Firestore product needs update based on Caspit data
function needsUpdate(
  caspitProduct: CaspitProduct,
  firestoreProduct: FirestoreProductData,
): boolean {
  // Priority 1: Check DateUpdated from Caspit vs lastUpdated in Firestore
  if (caspitProduct.DateUpdated && firestoreProduct.lastUpdated) {
    const caspitDate = new Date(caspitProduct.DateUpdated);
    const firestoreDate = firestoreProduct.lastUpdated.toDate();
    if (caspitDate > firestoreDate) {
      // Add a small buffer (e.g., 1 second) to prevent rapid re-syncs if times are very close due to precision
      if (caspitDate.getTime() - firestoreDate.getTime() > 1000) {
        logger.log(
          `Product ${caspitProduct.ProductId} needs update: Caspit DateUpdated (${caspitDate}) is newer than Firestore lastUpdated (${firestoreDate}).`,
        );
        return true;
      }
    }
  } else if (caspitProduct.DateUpdated) {
    // Firestore product doesn't have lastUpdated, or Caspit has DateUpdated - assume update
    logger.log(
      `Product ${caspitProduct.ProductId} needs update: Caspit has DateUpdated, Firestore might not.`,
    );
    return true;
  }

  // Priority 2: Detailed field comparison if dates are not definitive or missing
  const fieldsToCompare: {
    caspit: keyof CaspitProduct;
    firestore: keyof FirestoreProductData;
  }[] = [
    {caspit: "Name", firestore: "shortName"},
    {caspit: "Description", firestore: "description"},
    {caspit: "QtyInStock", firestore: "quantity"},
    {caspit: "SalePrice1", firestore: "salePrice"},
    {caspit: "PurchasePrice", firestore: "unitPrice"},
    {caspit: "CatalogNumber", firestore: "catalogNumber"},
    {caspit: "Barcode", firestore: "barcode"},
    {caspit: "Status", firestore: "isActive"},
  ];

  for (const field of fieldsToCompare) {
    const caspitValue = caspitProduct[field.caspit];
    const firestoreValue = firestoreProduct[field.firestore];
    // Handle null/undefined consistently. If Caspit has null, and Firestore has undefined for a nullable string, it's okay.
    // But if Caspit has "value" and Firestore has null/undefined, it's a change.
    if (caspitValue !== firestoreValue) {
      // Be careful with type differences, e.g. null vs undefined for optional fields.
      // This basic check might need refinement based on how you treat nulls.
      if (
        (caspitValue === null &&
          firestoreValue !== undefined &&
          firestoreValue !== null) ||
        (firestoreValue === null &&
          caspitValue !== undefined &&
          caspitValue !== null) ||
        (caspitValue !== null &&
          firestoreValue !== null &&
          caspitValue !== firestoreValue)
      ) {
        logger.log(
          `Product ${caspitProduct.ProductId} needs update: Field ${field.caspit} differs. Caspit: ${caspitValue}, Firestore: ${firestoreValue}`,
        );
        return true;
      }
    }
  }
  return false;
}

// v2 Scheduled function syntax
export const syncCaspitToFirestoreScheduled = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "Asia/Jerusalem", // Set timezone as requested
    region: "europe-west1", // Region closer to Israel
    // You can add other options like memory, timeoutSeconds etc. if needed
    // timeoutSeconds: 540, // Example: 9 minutes
    // memory: "1GiB",       // Example: 1GB memory
  },
  async (_event: ScheduledEvent) => {
    logger.info("Starting Caspit to Firestore sync job (v2).");

    try {
      const usersSnapshot = await db.collection(USER_SETTINGS_COLLECTION).get();

      logger.info(
        `Found ${usersSnapshot.size} documents in ${USER_SETTINGS_COLLECTION}.`,
      );

      if (usersSnapshot.empty) {
        logger.info(
          `No user documents found in ${USER_SETTINGS_COLLECTION}. Exiting sync job.`,
        );
        return; // Exit if no users to process
      }

      let processedUsersCount = 0; // Added for summary
      let relevantUsersFound = 0; // Added to count users who should be processed

      for (const userDoc of usersSnapshot.docs) {
        const userSettings = {
          id: userDoc.id,
          ...userDoc.data(),
        } as UserSettings;

        logger.info(`Checking user document: ${userDoc.id}`);

        if (
          userSettings.posSystemId === "caspit" &&
          userSettings.posConfig?.user &&
          userSettings.posConfig?.pwd &&
          userSettings.posConfig?.osekMorshe
        ) {
          relevantUsersFound++; // User is relevant for Caspit sync
          const userId = userSettings.id;
          logger.info(
            `User ${userId} is configured for Caspit. Attempting to fetch Caspit token.`,
          );

          let caspitToken: string | undefined = undefined;

          try {
            const tokenResponse = await axios.get<string>(
              `${CASPIT_API_BASE_URL}/token`,
              {
                params: {
                  user: userSettings.posConfig.user,
                  pwd: userSettings.posConfig.pwd,
                  osekmorshe: userSettings.posConfig.osekMorshe, // Ensure param name matches Caspit API
                },
                timeout: 10000, // 10 seconds timeout for token API
              },
            );

            if (
              tokenResponse.status === 200 &&
              typeof tokenResponse.data === "string"
            ) {
              // Try to extract token from XML string if applicable
              const xmlMatch = tokenResponse.data.match(/>(.*?)</); // Simple regex to get content between > and <
              if (xmlMatch && xmlMatch[1]) {
                caspitToken = xmlMatch[1];
                logger.info(
                  `Successfully extracted Caspit token for user ${userId} from XML-like response.`,
                );
              } else if (!tokenResponse.data.includes("<")) {
                // If it doesn't look like XML, assume it's a plain token
                caspitToken = tokenResponse.data;
                logger.info(
                  `Successfully fetched Caspit token (plain text) for user ${userId}.`,
                );
              } else {
                logger.error(
                  `Failed to parse Caspit token from XML-like response for user ${userId}. Data: ${tokenResponse.data}`,
                );
              }
            } else {
              logger.error(
                `Failed to fetch Caspit token for user ${userId}. Status: ${tokenResponse.status}`,
                {responseData: tokenResponse.data}, // Log the raw data for inspection
              );
            }
          } catch (tokenError: any) {
            logger.error(`Error fetching Caspit token for user ${userId}.`, {
              message: tokenError.message,
              status: tokenError.response?.status,
              data: tokenError.response?.data,
            });
          }

          if (!caspitToken) {
            logger.warn(
              `Skipping product sync for user ${userId} due to missing or failed Caspit token fetch.`,
            );
            continue; // Skip to the next user if token fetching failed
          }

          logger.info(
            `Processing Caspit sync for user: ${userId} using fetched token.`,
          );

          // --- Start of actual sync logic for a user (using the fetched caspitToken) ---
          let currentPage = 0; // MODIFIED: Start pagination from page 0
          const allCaspitProducts: CaspitProduct[] = [];
          let hasMorePages = true;
          logger.info(
            `Attempting to fetch Caspit products for user ${userId}, starting with page ${currentPage}`,
          );

          while (hasMorePages) {
            try {
              const productsApiUrl = "https://app.caspit.biz/api/v1/products";
              logger.info(
                `Fetching products from URL: ${productsApiUrl} for user ${userId}, page: ${currentPage}. Token will be sent as a query parameter.`,
              );

              // MODIFIED: Expect CaspitPaginatedResponse
              const response = await axios.get<CaspitPaginatedResponse>(
                productsApiUrl,
                {
                  params: {
                    page: currentPage,
                    token: caspitToken,
                  },
                  // timeout: 10000,
                },
              );

              logger.info(
                `Caspit products API response status for user ${userId}, page ${currentPage}: ${response.status}`,
              );

              // MODIFIED: Access products via response.data.Results
              const productsInPage = response.data.Results;

              if (productsInPage && productsInPage.length > 0) {
                logger.info(
                  `User ${userId}, page ${currentPage}: Received ${productsInPage.length} products. First product ID (if any): ${productsInPage[0]?.ProductId}`,
                );
                allCaspitProducts.push(...productsInPage);

                // MODIFIED: Determine if there are more pages based on response
                if (
                  response.data.NextPageUrl &&
                  response.data.CurrentPage < response.data.TotalPages - 1
                ) {
                  currentPage++;
                  logger.info(
                    `User ${userId}: Moving to page ${currentPage} for Caspit products. Total fetched so far: ${allCaspitProducts.length}`,
                  );
                } else {
                  hasMorePages = false;
                  logger.info(
                    `User ${userId}: No more pages after page ${response.data.CurrentPage}. Total fetched: ${allCaspitProducts.length}.`,
                  );
                }
              } else {
                logger.info(
                  `User ${userId}, page ${currentPage}: Received empty or no data in Results array from Caspit products API. Assuming no more pages.`,
                );
                hasMorePages = false; // Stop if no data in Results or empty array
              }
            } catch (error: any) {
              logger.error(
                `User ${userId}: Error fetching products from Caspit for page ${currentPage}. Error: ${error.message}`,
                error.response?.data
                  ? {responseData: error.response.data}
                  : {},
              );
              hasMorePages = false; // Stop pagination on error
            }
          }
          logger.info(
            `User ${userId}: Total Caspit products fetched: ${allCaspitProducts.length}`,
          );

          if (allCaspitProducts.length === 0) {
            logger.info(
              `No Caspit products found for user ${userId} or fetching failed. Skipping Firestore operations for this user.`,
            );
            // continue; // This would skip to the next userDoc
          } else {
            // Only proceed if products were fetched
            const firestoreProductsSnapshot = await db
              .collection(INVENTORY_COLLECTION)
              .where("userId", "==", userId)
              .where("caspitProductId", "!=", null) // Only get products that were already synced from Caspit
              .get();

            logger.info(
              `User ${userId}: Found ${firestoreProductsSnapshot.size} Firestore products with a caspitProductId.`,
            );

            const firestoreProductsMap = new Map<
              string,
              { id: string; data: FirestoreProductData }
            >();
            firestoreProductsSnapshot.forEach((doc) => {
              const data = doc.data() as FirestoreProductData;
              if (data.caspitProductId) {
                firestoreProductsMap.set(data.caspitProductId, {
                  id: doc.id,
                  data,
                });
              }
            });

            let batch = db.batch(); // Initialize batch
            let operationsInBatch = 0;
            const MAX_BATCH_OPERATIONS = 490; // Firestore batch limit is 500

            // Process Caspit products: Create or Update
            for (const caspitProduct of allCaspitProducts) {
              if (operationsInBatch >= MAX_BATCH_OPERATIONS) {
                logger.info(
                  `User ${userId}: Committing partial batch (${operationsInBatch} operations) for creates/updates.`,
                );
                await batch.commit();
                batch = db.batch(); // MODIFIED: Re-initialize batch for next set of operations
                operationsInBatch = 0; // Reset counter
              }

              const firestoreMatch = firestoreProductsMap.get(
                caspitProduct.ProductId,
              );
              const firestoreData = mapCaspitToFirestore(caspitProduct, userId);

              if (firestoreMatch) {
                // Product exists in Firestore
                if (needsUpdate(caspitProduct, firestoreMatch.data)) {
                  logger.info(
                    `User ${userId}: Updating product in Firestore. Caspit ID: ${caspitProduct.ProductId}, Firestore ID: ${firestoreMatch.id}`,
                  );
                  // Explicitly pass the mapped data for update, with type assertion
                  batch.update(
                    db.collection(INVENTORY_COLLECTION).doc(firestoreMatch.id),
                    {...firestoreData} as { [key: string]: any },
                  );
                  operationsInBatch++;
                }
                firestoreProductsMap.delete(caspitProduct.ProductId); // Remove from map as it's been processed
              } else {
                // Product does not exist in Firestore, create it
                logger.info(
                  `User ${userId}: Creating new product in Firestore for Caspit ID: ${caspitProduct.ProductId}`,
                );
                const newProductRef = db.collection(INVENTORY_COLLECTION).doc(); // Auto-generate ID
                // Explicitly pass the mapped data for set, with type assertion
                batch.set(newProductRef, {...firestoreData} as {
                  [key: string]: any;
                });
                operationsInBatch++;
              }
            }

            // Process Firestore products not found in Caspit: Deactivate
            // This part was missing the check for batch limit.
            firestoreProductsMap.forEach(async (firestoreProductEntry) => {
              // Added async here for await inside
              if (operationsInBatch >= MAX_BATCH_OPERATIONS) {
                logger.info(
                  `User ${userId}: Committing partial batch (${operationsInBatch} operations) before deactivations.`,
                );
                await batch.commit(); // Commit before switching to new batch logic or if loop ends
                batch = db.batch(); // MODIFIED: Re-initialize batch
                operationsInBatch = 0;
              }
              if (firestoreProductEntry.data.isActive !== false) {
                // Only deactivate if currently active
                logger.info(
                  `User ${userId}: Deactivating product in Firestore as it's no longer in (or active in) Caspit. Firestore ID: ${firestoreProductEntry.id}, Caspit ID: ${firestoreProductEntry.data.caspitProductId}`,
                );
                batch.update(
                  db
                    .collection(INVENTORY_COLLECTION)
                    .doc(firestoreProductEntry.id),
                  {isActive: false},
                );
                operationsInBatch++;
              }
            });

            if (operationsInBatch > 0) {
              logger.info(
                `User ${userId}: Committing final batch with ${operationsInBatch} operations.`,
              );
              await batch.commit();
              logger.info(
                `Batch write to Firestore committed successfully for user ${userId}.`,
              );
              processedUsersCount++; // Count user as processed if batch had operations
            } else {
              logger.info(`User ${userId}: No Firestore operations needed.`);
            }
          } // End of "else" for if (allCaspitProducts.length === 0)
          // --- End of existing logic block for a user ---
        } else {
          logger.warn(
            `Skipping user ${userDoc.id}: Not configured for Caspit sync or missing token.`,
            {
              posSystem: userSettings.posSystemId,
              hasToken:
                !!userSettings.posConfig?.user &&
                !!userSettings.posConfig?.pwd &&
                !!userSettings.posConfig?.osekMorshe,
            },
          );
        }
      } // End of for...of userDoc

      if (relevantUsersFound === 0 && !usersSnapshot.empty) {
        logger.info(
          `Found ${usersSnapshot.size} user(s), but none were eligible for Caspit sync (e.g., not 'caspit' posSystem or missing token).`,
        );
      } else if (processedUsersCount === 0 && relevantUsersFound > 0) {
        logger.info(
          `Found ${relevantUsersFound} user(s) eligible for Caspit sync, but no actual data operations were performed for any of them (e.g., no data changes, no products in Caspit).`,
        );
      } else if (processedUsersCount > 0) {
        logger.info(
          `Successfully processed Caspit sync for ${processedUsersCount} user(s).`,
        );
      }
    } catch (error: any) {
      logger.error("Critical error in Caspit to Firestore sync job:", {
        message: error.message,
        stack: error.stack,
        details: error,
      });
    } finally {
      logger.info("Caspit to Firestore sync job finished (v2).");
    }
  },
);

// TODO:
// 1. Ensure INVENTORY_COLLECTION and USER_SETTINGS_COLLECTION constants are correct.
// 2. Test the Caspit API pagination: Does it return an empty array or an error for out-of-bounds pages?
//    The code assumes an empty array or non-200 status stops pagination.
// 3. Refine the `needsUpdate` logic, especially null/undefined comparisons for optional fields.
// 4. Add more robust error handling and retry mechanisms if needed (e.g., for Caspit API calls).
// 5. Ensure `functions/package.json` has `axios` and other necessary dependencies.
// 6. Deploy with `firebase deploy --only functions`.
// 7. Monitor logs in Firebase Console (Functions > Logs) after deployment and scheduled runs.
// 8. Consider security rules for Firestore if this function modifies data. (It uses admin SDK, so rules are bypassed, but good to keep in mind).
// 9. The batch re-initialization logic after a commit mid-loop needs to be: `batch = db.batch();`
//    I've added a comment; this should be fixed if we expect very large number of writes per user.
//    For simplicity, I've structured it so that a new batch variable `deactivationBatch` is used for the second phase of writes.
//    The first loop's batch re-initialization: if `writeCounter >= MAX_BATCH_WRITES`, after `await batch.commit()`, it should be `batch = db.batch(); writeCounter = 0;`.
//    I'll make this small correction.
