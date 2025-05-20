// src/app/edit-invoice/hooks/useInvoiceLoader.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';
import type { EditableProduct, EditableTaxInvoiceDetails, InvoiceHistoryItem } from '../types';
import {
    TEMP_DATA_KEY_PREFIX,
    getStorageKey,
    DOCUMENTS_COLLECTION,
    Product,
} from '@/services/backend';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { v4 as uuidv4 } from 'uuid'; // Import uuid

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
  docType: 'deliveryNote' | 'invoice' | null;
  localStorageScanDataMissing: boolean;
  aiScannedSupplierNameFromStorage: string | undefined;
  initialSelectedPaymentDueDate?: Date;
  cleanupTemporaryData: () => void;
  initialDataLoaded: boolean;
}

export function useInvoiceLoader({}: UseInvoiceLoaderProps): UseInvoiceLoaderReturn {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  const docType = useMemo(() => searchParams.get('docType') as 'deliveryNote' | 'invoice' | null, [searchParams]);
  const initialTempInvoiceId = useMemo(() => searchParams.get('tempInvoiceId'), [searchParams]);
  const initialInvoiceIdParam = useMemo(() => searchParams.get('invoiceId'), [searchParams]);
  const localStorageScanDataMissing = useMemo(() => searchParams.get('localStorageScanDataMissing') === 'true', [searchParams]);
  const keyParamFromUrl = useMemo(() => searchParams.get('key'), [searchParams]);
  const urlOriginalFileName = useMemo(() => searchParams.get('originalFileName'), [searchParams]);


  const [initialProducts, setInitialProducts] = useState<EditableProduct[]>([]);
  const [initialTaxDetails, setInitialTaxDetails] = useState<EditableTaxInvoiceDetails>({});
  const [originalFileName, setOriginalFileName] = useState<string>('Unknown Document');
  const [displayedOriginalImageUrl, setDisplayedOriginalImageUrl] = useState<string | null>(null);
  const [displayedCompressedImageUrl, setDisplayedCompressedImageUrl] = useState<string | null>(null);
  const [isNewScanState, setIsNewScanState] = useState(false);
  const [isViewModeInitially, setIsViewModeInitially] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [scanProcessErrorFromLoad, setScanProcessErrorFromLoad] = useState<string | null>(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [aiScannedSupplierNameFromStorage, setAiScannedSupplierNameFromStorage] = useState<string | undefined>(undefined);
  const [initialSelectedPaymentDueDate, setInitialSelectedPaymentDueDate] = useState<Date | undefined>();


  const cleanupTemporaryData = useCallback(() => {
    if (keyParamFromUrl && user?.id) {
      const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${keyParamFromUrl}`);
      localStorage.removeItem(dataKey);
      console.log(`[useInvoiceLoader][cleanupTemporaryData] Cleared localStorage (if existed): ${dataKey}`);
    }
  }, [keyParamFromUrl, user?.id]);

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

      const currentIsNewScan = !initialInvoiceIdParam && (!!initialTempInvoiceId || !!keyParamFromUrl);
      setIsNewScanState(currentIsNewScan);

      if (currentIsNewScan) {
        setIsViewModeInitially(false);
        setInitialProducts([]);
        setInitialTaxDetails({});
        setAiScannedSupplierNameFromStorage(undefined);
        setInitialSelectedPaymentDueDate(undefined);
      } else if (initialInvoiceIdParam) {
        setIsViewModeInitially(true);
      } else { 
        setIsViewModeInitially(false);
        setOriginalFileName('Manual Entry');
        setIsNewScanState(true);
      }

      setOriginalFileName(urlOriginalFileName || (docType === 'invoice' ? 'New Invoice' : 'New Delivery Note'));
      let pendingDocSnap: any = null;
      let loadedProducts: EditableProduct[] = [];
      let loadedTaxDetails: Partial<EditableTaxInvoiceDetails> = {};
      let localAiScannedSupplier: string | undefined = undefined;

      try {
        if (initialInvoiceIdParam && db && user?.id) {
          const finalDocRef = doc(db, DOCUMENTS_COLLECTION, initialInvoiceIdParam);
          pendingDocSnap = await getDoc(finalDocRef);
          if (!pendingDocSnap.exists() || pendingDocSnap.data()?.userId !== user.id) {
            setDataError(`Invoice not found or access denied (ID: ${initialInvoiceIdParam}).`);
            pendingDocSnap = null;
          }
        } else if (initialTempInvoiceId && db && user?.id) {
          const pendingDocRef = doc(db, DOCUMENTS_COLLECTION, initialTempInvoiceId);
          pendingDocSnap = await getDoc(pendingDocRef);
          if (!pendingDocSnap.exists() || pendingDocSnap.data()?.userId !== user.id) {
            setDataError(`Pending scan data not found (Temp ID: ${initialTempInvoiceId}).`);
            pendingDocSnap = null;
          }
        }

        let rawScanResultJsonFromStorage: string | null = null;

        if (pendingDocSnap && pendingDocSnap.exists()) {
          const pendingData = pendingDocSnap.data() as InvoiceHistoryItem;
          setOriginalFileName(pendingData.originalFileName || 'Scanned Document');
          loadedTaxDetails = {
            supplierName: pendingData.supplierName || null,
            invoiceNumber: pendingData.invoiceNumber || null,
            totalAmount: pendingData.totalAmount ?? null,
            invoiceDate: pendingData.invoiceDate || null,
            paymentMethod: pendingData.paymentMethod || null,
            paymentDueDate: pendingData.paymentDueDate || null,
          };
          localAiScannedSupplier = pendingData.supplierName || undefined;
          if (pendingData.paymentDueDate) {
              let dateToSet: Date | undefined;
              if (pendingData.paymentDueDate instanceof Timestamp) dateToSet = pendingData.paymentDueDate.toDate();
              else if (typeof pendingData.paymentDueDate === 'string' && isValid(parseISO(pendingData.paymentDueDate))) dateToSet = parseISO(pendingData.paymentDueDate);
              else if (pendingData.paymentDueDate instanceof Date && isValid(pendingData.paymentDueDate)) dateToSet = pendingData.paymentDueDate;
              if (dateToSet) setInitialSelectedPaymentDueDate(dateToSet);
          }
          setDisplayedOriginalImageUrl(pendingData.originalImagePreviewUri || null);
          setDisplayedCompressedImageUrl(pendingData.compressedImageForFinalRecordUri || null);
          rawScanResultJsonFromStorage = pendingData.rawScanResultJson || null;
          if(pendingData.errorMessage) setScanProcessErrorFromLoad(pendingData.errorMessage);
        } else if (currentIsNewScan && !initialInvoiceIdParam && !initialTempInvoiceId && localStorageScanDataMissing) {
          const lsMissingError = `Critical: Scan data was not saved to server and is also missing from local storage. Please try scanning again.`;
          setDataError(lsMissingError);
          setScanProcessErrorFromLoad(lsMissingError);
        } else if (currentIsNewScan && !initialInvoiceIdParam && !initialTempInvoiceId && keyParamFromUrl && user?.id) {
          const dataKey = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${keyParamFromUrl}`);
          rawScanResultJsonFromStorage = localStorage.getItem(dataKey);
          if (!rawScanResultJsonFromStorage) {
            const lsError = `Scan results not found locally for key: ${keyParamFromUrl}. The data might have been cleared or not saved.`;
            setDataError(lsError); 
          }
        }

        if (rawScanResultJsonFromStorage) {
          try {
            const parsedScanResult = JSON.parse(rawScanResultJsonFromStorage);
            if (docType === 'deliveryNote' && parsedScanResult && 'products' in parsedScanResult && Array.isArray(parsedScanResult.products)) {
              loadedProducts = parsedScanResult.products.map((p: any) => {
                const uniqueId = p.id || p.catalogNumber || `scan-temp-${uuidv4()}`; // Use uuid
                return {
                    id: uniqueId,
                    _originalId: uniqueId, // Use the same for _originalId initially
                    userId: user.id!,
                    catalogNumber: p.catalogNumber || 'N/A',
                    description: p.product_name || p.description || 'N/A',
                    shortName: p.shortName || p.short_product_name || p.product_name?.substring(0,20) || 'N/A',
                    quantity: typeof p.quantity === 'number' ? p.quantity : parseFloat(String(p.quantity)) || 0,
                    unitPrice: (p.purchase_price !== undefined ? Number(p.purchase_price) : (p.unitPrice !== undefined ? Number(p.unitPrice) : 0)),
                    lineTotal: p.total !== undefined ? Number(p.total) : ((typeof p.quantity === 'number' ? p.quantity : 0) * ((p.purchase_price !== undefined ? Number(p.purchase_price) : (p.unitPrice !== undefined ? Number(p.unitPrice) : 0)))),
                    salePrice: undefined, 
                    minStockLevel: p.minStockLevel !== undefined ? Number(p.minStockLevel) : null,
                    maxStockLevel: p.maxStockLevel !== undefined ? Number(p.maxStockLevel) : null,
                    imageUrl: p.imageUrl === undefined ? null : p.imageUrl,
                } as EditableProduct
              });
            } else if (docType === 'invoice' && parsedScanResult) {
              const taxScan = parsedScanResult as ScanTaxInvoiceOutput;
              loadedTaxDetails = {
                supplierName: loadedTaxDetails.supplierName || taxScan.supplierName || null,
                invoiceNumber: loadedTaxDetails.invoiceNumber || taxScan.invoiceNumber || null,
                totalAmount: loadedTaxDetails.totalAmount ?? taxScan.totalAmount ?? null,
                invoiceDate: loadedTaxDetails.invoiceDate || taxScan.invoiceDate || null,
                paymentMethod: loadedTaxDetails.paymentMethod || taxScan.paymentMethod || null,
              };
              localAiScannedSupplier = loadedTaxDetails.supplierName || localAiScannedSupplier;
            }
            const generalErrorFromScanResult = (parsedScanResult as any)?.error;
            if (generalErrorFromScanResult && !scanProcessErrorFromLoad) {
               setScanProcessErrorFromLoad(generalErrorFromScanResult);
            }
          } catch (jsonError) {
            const parseErrorMsg = `Error parsing scan data. It might be corrupted.`;
            if (!scanProcessErrorFromLoad) setScanProcessErrorFromLoad(prev => prev ? `${prev}; ${parseErrorMsg}` : parseErrorMsg);
            if (!dataError) setDataError(parseErrorMsg);
          }
        }
        else if (pendingDocSnap?.exists() && pendingDocSnap.data()?.products && docType === 'deliveryNote') {
            loadedProducts = pendingDocSnap.data()?.products.map((p: Product) => ({ ...p, _originalId: p.id })) || [];
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

    if(user?.id) load();

  }, [user, authLoading, initialDataLoaded, initialTempInvoiceId, initialInvoiceIdParam, keyParamFromUrl, docType, localStorageScanDataMissing, urlOriginalFileName]);


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