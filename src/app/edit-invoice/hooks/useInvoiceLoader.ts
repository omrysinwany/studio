// src/app/edit-invoice/hooks/useInvoiceLoader.ts
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { format, parseISO, isValid } from "date-fns";
import type {
  EditableProduct,
  EditableTaxInvoiceDetails,
  InvoiceHistoryItem,
} from "../types";
import {
  TEMP_DATA_KEY_PREFIX,
  getStorageKey,
  USERS_COLLECTION,
  DOCUMENTS_SUBCOLLECTION,
  Product,
  clearTemporaryScanData,
} from "@/services/backend";

import type { ScanInvoiceOutput } from "@/ai/flows/invoice-schemas";
import type { ScanTaxInvoiceOutput } from "@/ai/flows/tax-invoice-schemas";
import { v4 as uuidv4 } from "uuid"; // Import uuid

interface UseInvoiceLoaderProps {}

export interface UseInvoiceLoaderReturn {
  initialProducts: EditableProduct[];
  initialTaxDetails: EditableTaxInvoiceDetails;
  originalFileName: string;
  displayedOriginalImageUrl: string | null;
  displayedCompressedImageUrl: string | null;
  isNewScan: boolean;
  isViewModeInitially: boolean;
  isLoading: boolean;
  dataError: string | null;
  scanProcessErrorFromLoad: string | null;
  initialTempInvoiceId: string | null;
  initialInvoiceIdParam: string | null;
  docType: "deliveryNote" | "invoice" | null;
  localStorageScanDataMissing: boolean;
  aiScannedSupplierNameFromStorage: string | undefined;
  initialSelectedPaymentDueDate?: Date;
  cleanupTemporaryData: (tempId?: string) => void;
  initialDataLoaded: boolean;
}

export function useInvoiceLoader({}: UseInvoiceLoaderProps): UseInvoiceLoaderReturn {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  const docType = useMemo(
    () => searchParams.get("docType") as "deliveryNote" | "invoice" | null,
    [searchParams]
  );
  const initialTempInvoiceId = useMemo(
    () => searchParams.get("tempInvoiceId"),
    [searchParams]
  );
  const initialInvoiceIdParam = useMemo(
    () => searchParams.get("invoiceId"),
    [searchParams]
  );
  const localStorageScanDataMissing = useMemo(
    () => searchParams.get("localStorageScanDataMissing") === "true",
    [searchParams]
  );
  const keyParamFromUrl = useMemo(
    () => searchParams.get("key"),
    [searchParams]
  );
  const urlOriginalFileName = useMemo(
    () => searchParams.get("originalFileName"),
    [searchParams]
  );

  const [initialProducts, setInitialProducts] = useState<EditableProduct[]>([]);
  const [initialTaxDetails, setInitialTaxDetails] =
    useState<EditableTaxInvoiceDetails>({});
  const [originalFileName, setOriginalFileName] =
    useState<string>("Unknown Document");
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<
    string | null
  >(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] =
    useState<string | null>(null);
  const [isNewScanState, setIsNewScanState] = useState(false);
  const [isViewModeInitially, setIsViewModeInitially] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [scanProcessErrorFromLoad, setScanProcessErrorFromLoad] = useState<
    string | null
  >(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [
    aiScannedSupplierNameFromStorage,
    setAiScannedSupplierNameFromStorage,
  ] = useState<string | undefined>(undefined);
  const [initialSelectedPaymentDueDate, setInitialSelectedPaymentDueDate] =
    useState<Date | undefined>();

  const cleanupTemporaryData = useCallback(
    async (tempId?: string) => {
      const idToClear = tempId || initialTempInvoiceId;
      if (idToClear && user?.id) {
        try {
          console.log(
            `[useInvoiceLoader] Attempting to delete temporary scan data for ID: ${idToClear}`
          );
          clearTemporaryScanData(idToClear, user.id);
          // Also clear from localStorage if it was stored there
          localStorage.removeItem(`${TEMP_DATA_KEY_PREFIX}${idToClear}`);
          console.log(
            `[useInvoiceLoader] Temporary data for ID ${idToClear} cleared from service and localStorage.`
          );
        } catch (error) {
          console.error(
            `[useInvoiceLoader] Error cleaning up temporary data for ID ${idToClear}:`,
            error
          );
        }
      }
    },
    [user?.id, initialTempInvoiceId]
  );

  useEffect(() => {
    if (authLoading || initialDataLoaded) return;
    if (!user && !authLoading) {
      setDataError("User not authenticated. Please login.");
      setIsLoading(false);
      return;
    }
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setDataError(null);
      setScanProcessErrorFromLoad(null);

      const currentIsNewScan =
        !initialInvoiceIdParam && (!!initialTempInvoiceId || !!keyParamFromUrl);
      setIsNewScanState(currentIsNewScan);

      if (currentIsNewScan) {
        setIsViewModeInitially(true);
        setInitialProducts([]);
        setInitialTaxDetails({});
        setAiScannedSupplierNameFromStorage(undefined);
        setInitialSelectedPaymentDueDate(undefined);
        console.log(
          "[useInvoiceLoader] New scan detected (tempId/key). Setting isViewModeInitially to true."
        );
      } else if (initialInvoiceIdParam) {
        setIsViewModeInitially(true);
        console.log(
          "[useInvoiceLoader] Existing invoiceId detected. Setting isViewModeInitially to true."
        );
      } else {
        setIsViewModeInitially(false);
        setOriginalFileName("Manual Entry");
        setIsNewScanState(true);
        console.log(
          "[useInvoiceLoader] No invoiceId or tempId (manual entry). Setting isViewModeInitially to false."
        );
      }

      setOriginalFileName(
        urlOriginalFileName ||
          (docType === "invoice" ? "New Invoice" : "New Delivery Note")
      );
      let pendingDocSnap: any = null;
      let loadedProducts: EditableProduct[] = [];
      let loadedTaxDetails: Partial<EditableTaxInvoiceDetails> = {};
      let localAiScannedSupplier: string | undefined = undefined;

      try {
        if (initialInvoiceIdParam && db && user?.id) {
          const finalDocRef = doc(
            db,
            USERS_COLLECTION,
            user.id,
            DOCUMENTS_SUBCOLLECTION,
            initialInvoiceIdParam
          );
          pendingDocSnap = await getDoc(finalDocRef);
          if (
            !pendingDocSnap.exists() ||
            pendingDocSnap.data()?.userId !== user.id
          ) {
            setDataError(
              `Invoice not found or access denied (ID: ${initialInvoiceIdParam}).`
            );
            pendingDocSnap = null;
          }
        } else if (initialTempInvoiceId && db && user?.id) {
          const pendingDocRef = doc(
            db,
            USERS_COLLECTION,
            user.id,
            DOCUMENTS_SUBCOLLECTION,
            initialTempInvoiceId
          );
          pendingDocSnap = await getDoc(pendingDocRef);
          if (
            !pendingDocSnap.exists() ||
            pendingDocSnap.data()?.userId !== user.id
          ) {
            setDataError(
              `Pending scan data not found (Temp ID: ${initialTempInvoiceId}).`
            );
            pendingDocSnap = null;
          }
        }

        let rawScanResultJsonFromStorage: string | null = null;

        if (pendingDocSnap && pendingDocSnap.exists()) {
          const pendingData = pendingDocSnap.data() as InvoiceHistoryItem;
          setOriginalFileName(
            pendingData.originalFileName || "Scanned Document"
          );
          rawScanResultJsonFromStorage = pendingData.rawScanResultJson || null;
          loadedTaxDetails = {
            supplierName: pendingData.supplierName || null,
            invoiceNumber: pendingData.invoiceNumber || null,
            totalAmount: pendingData.totalAmount ?? null,
            invoiceDate: pendingData.invoiceDate || null,
            paymentMethod: pendingData.paymentMethod || null,
            paymentDueDate: pendingData.paymentDueDate || null,
            rawScanResultJson: rawScanResultJsonFromStorage,
          };
          localAiScannedSupplier = pendingData.supplierName || undefined;
          if (pendingData.paymentDueDate) {
            let dateToSet: Date | undefined;
            if (pendingData.paymentDueDate instanceof Timestamp)
              dateToSet = pendingData.paymentDueDate.toDate();
            else if (
              typeof pendingData.paymentDueDate === "string" &&
              isValid(parseISO(pendingData.paymentDueDate))
            )
              dateToSet = parseISO(pendingData.paymentDueDate);
            else if (
              pendingData.paymentDueDate instanceof Date &&
              isValid(pendingData.paymentDueDate)
            )
              dateToSet = pendingData.paymentDueDate;
            if (dateToSet) setInitialSelectedPaymentDueDate(dateToSet);
          }
          setDisplayedOriginalImageUrl(
            pendingData.originalImagePreviewUri || null
          );
          setDisplayedCompressedImageUrl(
            pendingData.compressedImageForFinalRecordUri || null
          );
          if (pendingData.errorMessage)
            setScanProcessErrorFromLoad(pendingData.errorMessage);
        } else if (
          currentIsNewScan &&
          !initialInvoiceIdParam &&
          !initialTempInvoiceId &&
          localStorageScanDataMissing
        ) {
          const lsMissingError = `Critical: Scan data was not saved to server and is also missing from local storage. Please try scanning again.`;
          setDataError(lsMissingError);
          setScanProcessErrorFromLoad(lsMissingError);
        } else if (
          currentIsNewScan &&
          !initialInvoiceIdParam &&
          !initialTempInvoiceId &&
          keyParamFromUrl &&
          user?.id
        ) {
          const storageKey = getStorageKey(
            `${TEMP_DATA_KEY_PREFIX}${keyParamFromUrl}`,
            user.id
          );
          rawScanResultJsonFromStorage = localStorage.getItem(storageKey);
          if (!rawScanResultJsonFromStorage) {
            const lsError = `Scan results not found locally for key: ${keyParamFromUrl}. The data might have been cleared or not saved.`;
            setDataError(lsError);
          }
        }

        if (rawScanResultJsonFromStorage) {
          try {
            const parsedScanResult = JSON.parse(rawScanResultJsonFromStorage);
            if (
              docType === "deliveryNote" &&
              parsedScanResult &&
              "products" in parsedScanResult &&
              Array.isArray(parsedScanResult.products)
            ) {
              const seenOriginalIds = new Set<string>();
              loadedProducts = parsedScanResult.products.map(
                (p: any, index: number) => {
                  const clientSideUniqueId = `scan-item-${uuidv4()}`;
                  const originalIdentifier = p.id || p.catalogNumber;

                  // If the original identifier is duplicated in the scan, make it unique for _originalId as well,
                  // though backend logic should ultimately handle matching.
                  // For now, we primarily ensure clientSideUniqueId is unique for React keys.
                  // The backend services (checkProductPricesBeforeSaveService, finalizeSaveProductsService)
                  // will use _originalId for matching existing DB products.
                  // If p.id or p.catalogNumber can be non-unique in a single scan but refer to *different* new items,
                  // this needs more sophisticated handling, possibly by prompting user or using more fields for uniqueness.
                  // For now, this ensures the client-side ID is unique for React.

                  return {
                    id: clientSideUniqueId, // Always unique for client-side (React key, etc.)
                    _originalId:
                      originalIdentifier ||
                      `temp-scan-orig-${index}-${uuidv4()}`, // Preserve original for matching, ensure it's at least defined
                    userId: user.id!,
                    catalogNumber: p.catalogNumber || null, // Keep null if not provided, instead of 'N/A' string if possible
                    description:
                      p.product_name || p.description || "Untitled Product",
                    shortName:
                      p.shortName ||
                      p.short_product_name ||
                      p.product_name?.substring(0, 25) ||
                      p.description?.substring(0, 25) ||
                      "Untitled",
                    quantity:
                      typeof p.quantity === "number"
                        ? p.quantity
                        : parseFloat(String(p.quantity)) || 0,
                    unitPrice:
                      p.purchase_price !== undefined
                        ? Number(p.purchase_price)
                        : p.unitPrice !== undefined
                        ? Number(p.unitPrice)
                        : 0,
                    lineTotal:
                      p.total !== undefined
                        ? Number(p.total)
                        : (typeof p.quantity === "number" ? p.quantity : 0) *
                          (p.purchase_price !== undefined
                            ? Number(p.purchase_price)
                            : p.unitPrice !== undefined
                            ? Number(p.unitPrice)
                            : 0),
                    salePrice:
                      p.salePrice !== undefined ? Number(p.salePrice) : null,
                    minStockLevel:
                      p.minStockLevel !== undefined
                        ? Number(p.minStockLevel)
                        : null,
                    maxStockLevel:
                      p.maxStockLevel !== undefined
                        ? Number(p.maxStockLevel)
                        : null,
                    imageUrl: p.imageUrl === undefined ? null : p.imageUrl,
                    // Ensure all fields from EditableProduct/BackendProduct are initialized if not from scan
                    barcode: p.barcode || null,
                  } as EditableProduct;
                }
              );
            } else if (docType === "invoice" && parsedScanResult) {
              const taxScan = parsedScanResult as ScanTaxInvoiceOutput;
              loadedTaxDetails = {
                supplierName:
                  loadedTaxDetails.supplierName || taxScan.supplierName || null,
                invoiceNumber:
                  loadedTaxDetails.invoiceNumber ||
                  taxScan.invoiceNumber ||
                  null,
                totalAmount:
                  loadedTaxDetails.totalAmount ?? taxScan.totalAmount ?? null,
                invoiceDate:
                  loadedTaxDetails.invoiceDate || taxScan.invoiceDate || null,
                paymentMethod:
                  loadedTaxDetails.paymentMethod ||
                  taxScan.paymentMethod ||
                  null,
                rawScanResultJson: rawScanResultJsonFromStorage,
              };
              localAiScannedSupplier =
                loadedTaxDetails.supplierName || localAiScannedSupplier;
            }
            const generalErrorFromScanResult = (parsedScanResult as any)?.error;
            if (generalErrorFromScanResult && !scanProcessErrorFromLoad) {
              setScanProcessErrorFromLoad(generalErrorFromScanResult);
            }
          } catch (jsonError) {
            const parseErrorMsg = `Error parsing scan data. It might be corrupted.`;
            if (!scanProcessErrorFromLoad)
              setScanProcessErrorFromLoad((prev) =>
                prev ? `${prev}; ${parseErrorMsg}` : parseErrorMsg
              );
            if (!dataError) setDataError(parseErrorMsg);
          }
        } else if (
          pendingDocSnap?.exists() &&
          pendingDocSnap.data()?.products &&
          docType === "deliveryNote"
        ) {
          loadedProducts =
            pendingDocSnap
              .data()
              ?.products.map((p: Product) => ({ ...p, _originalId: p.id })) ||
            [];
        }

        setInitialProducts(loadedProducts);
        setInitialTaxDetails(loadedTaxDetails);
        setAiScannedSupplierNameFromStorage(localAiScannedSupplier);
      } catch (e) {
        console.error("[useInvoiceLoader] Outer catch block error:", e);
        setDataError(`Failed to load invoice data: ${(e as Error).message}`);
      } finally {
        setIsLoading(false);
        setInitialDataLoaded(true);
      }
    };

    if (user?.id) load();
  }, [
    user,
    authLoading,
    initialDataLoaded,
    initialTempInvoiceId,
    initialInvoiceIdParam,
    keyParamFromUrl,
    docType,
    localStorageScanDataMissing,
    urlOriginalFileName,
  ]);

  return {
    initialProducts,
    initialTaxDetails,
    originalFileName,
    displayedOriginalImageUrl,
    displayedCompressedImageUrl,
    isNewScan: isNewScanState,
    isViewModeInitially,
    isLoading,
    dataError,
    scanProcessErrorFromLoad,
    initialTempInvoiceId,
    initialInvoiceIdParam,
    docType,
    localStorageScanDataMissing,
    aiScannedSupplierNameFromStorage,
    initialSelectedPaymentDueDate,
    cleanupTemporaryData,
    initialDataLoaded,
  };
}
