// src/app/upload/page.tsx
'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { scanInvoice } from '@/ai/flows/scan-invoice';
import type { ScanInvoiceOutput } from '@/ai/flows/invoice-schemas';
import { scanTaxInvoice } from '@/ai/flows/scan-tax-invoice';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText as FileTextIconLucide, Clock, CheckCircle, XCircle, Loader2, Image as ImageIconLucide, Info, Edit, RefreshCw, X as ClearIcon } from 'lucide-react';
import {
    InvoiceHistoryItem,
    getInvoicesService,
    TEMP_DATA_KEY_PREFIX, // Used for localStorage JSON scan results if Firestore pending doc fails
    MAX_SCAN_RESULTS_SIZE_BYTES, // To check AI output size before storing anywhere
    clearTemporaryScanData, // Clears localStorage scan JSON
    MAX_INVOICE_HISTORY_ITEMS,
    getStorageKey,
    finalizeSaveProductsService, // This is called from edit-invoice page
    clearOldTemporaryScanData,
    DOCUMENTS_COLLECTION, // For Firestore operations
} from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isValid, } from 'date-fns';
import { Timestamp, doc, setDoc, serverTimestamp, FieldValue } from 'firebase/firestore'; // Added FieldValue
import { db } from '@/lib/firebase';
import { enUS, he } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


const isValidImageSrc = (src: string | undefined | null): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};

// This function is kept for client-side compression if needed before AI scan, or for previews
// but is NOT used for storing images in Firebase Storage directly anymore.
async function compressImage(base64Str: string, quality = 0.6, maxWidth = 800, maxHeight = 1024): Promise<string> {
    console.log(`[compressImage] Starting compression. Quality: ${quality}, MaxWidth: ${maxWidth}, MaxHeight: ${maxHeight}, Original size (approx chars): ${base64Str.length}`);
    return new Promise((resolve, reject) => {
        const img = new window.Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error("[compressImage] Failed to get canvas context");
                return reject(new Error('Failed to get canvas context'));
            }
            ctx.drawImage(img, 0, 0, width, height);
            const mimeType = base64Str.substring(base64Str.indexOf(':') + 1, base64Str.indexOf(';'));
            const outputMimeType = (mimeType === 'image/png') ? 'image/jpeg' : 'image/jpeg';
            const compressedDataUrl = canvas.toDataURL(outputMimeType, quality);
            console.log(`[compressImage] Compression complete. New size (approx chars): ${compressedDataUrl.length}`);
            resolve(compressedDataUrl);
        };
        img.onerror = (error) => {
            console.error("[compressImage] Image load error for compression:", error);
            reject(new Error('Failed to load image for compression'));
        };
    });
}


export default function UploadPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t, locale } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isPdfPreview, setIsPdfPreview] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [documentType, setDocumentType] = useState<'deliveryNote' | 'invoice'>('deliveryNote');


  const fetchHistory = useCallback(async () => {
    if (!user || !user.id) {
        setUploadHistory([]);
        setIsLoadingHistory(false);
        return;
    }
    console.log("[UploadPage] fetchHistory called for user:", user.id);
    setIsLoadingHistory(true);
    setUploadHistory([]); // Clear previous user's history
    try {
      const invoices = await getInvoicesService(user.id);
      setUploadHistory(invoices.slice(0, MAX_INVOICE_HISTORY_ITEMS));
      console.log("[UploadPage] Fetched history items:", invoices.slice(0, MAX_INVOICE_HISTORY_ITEMS).length);
    } catch (error) {
      console.error("[UploadPage] Failed to load upload history:", error);
      toast({
        title: t('upload_toast_history_load_fail_title'),
        description: `${t('upload_toast_history_load_fail_desc')} (${(error as Error).message})`,
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
      console.log("[UploadPage] fetchHistory finished. isLoadingHistory set to false.");
    }
  }, [toast, t, user]);

  useEffect(() => {
    if (authLoading) {
      console.log("[UploadPage] Auth loading, clearing history and setting loading state.");
      setUploadHistory([]);
      setIsLoadingHistory(true);
      return;
    }
    if (!user && !authLoading) {
      console.log("[UploadPage] No user and not auth loading, redirecting to login.");
      router.push('/login');
      setUploadHistory([]); 
      setIsLoadingHistory(false);
    } else if (user && user.id) {
      console.log("[UploadPage] User identified, fetching history and clearing old temp data. User ID:", user.id);
      setUploadHistory([]); 
      setIsLoadingHistory(true); 
      fetchHistory();
      clearOldTemporaryScanData(false, user.id);
    }
  }, [user, authLoading, router, fetchHistory]);


  const processFileForPreview = (file: File) => {
    setSelectedFile(file);
    setScanError(null);
    setUploadProgress(0);
    setStreamingContent('');
    if (file.type.startsWith('image/')) {
        setIsPdfPreview(false);
        const reader = new FileReader();
        reader.onloadend = () => {
            setFilePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
        setIsPdfPreview(true);
        setFilePreview(null);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const validTypes = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp', 'image/gif'];
      if (validTypes.includes(file.type) || file.type.startsWith('image/')) {
        processFileForPreview(file);
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        clearSelection();
      }
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      const validTypes = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp', 'image/gif'];
       if (validTypes.includes(file.type) || file.type.startsWith('image/')) {
         processFileForPreview(file);
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        clearSelection();
      }
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setFilePreview(null);
    setIsPdfPreview(false);
    setScanError(null);
    setUploadProgress(0);
    setStreamingContent('');
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };


 const handleUpload = async () => {
    if (!selectedFile || !user || !user.id) {
        console.error("[UploadPage] handleUpload aborted: No file selected, user not authenticated, or missing user ID.");
        toast({ title: t('error_title'), description: t('upload_toast_upload_failed_no_file_user_desc'), variant: 'destructive' });
        return;
    }
    console.log(`[UploadPage] handleUpload started. File: ${selectedFile.name}, Type: ${documentType}, User: ${user.id}`);

    setIsUploading(true);
    setIsProcessing(true);
    setUploadProgress(0);
    setStreamingContent(t('upload_preparing_file'));
    setScanError(null);

    const originalFileName = selectedFile.name;
    const safeFileNamePartForId = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50);
    const uniqueScanIdPart = `${Date.now()}_${safeFileNamePartForId}`;
    const tempInvoiceId = `pending-inv-${user.id}_${uniqueScanIdPart}`;

    // Key for localStorage, used as a fallback if Firestore pending doc creation initially fails or for quick resume scenarios (less critical now)
    const dataKeyForLocalStorageJson = getStorageKey(TEMP_DATA_KEY_PREFIX, `${user.id}_${uniqueScanIdPart}`);

    let finalScanResult: ScanInvoiceOutput | ScanTaxInvoiceOutput | null = null;
    let originalImagePreviewDataUri: string | null = null; // Will hold base64 for Firestore
    let compressedImageForFinalRecordDataUri: string | null = null; // Will hold base64 for Firestore
    let scanDataSavedForLocalStorage = false; // Still useful to track if this succeeds as a fallback
    let pendingFirestoreDocCreated = false;

    const reader = new FileReader();
    reader.readAsDataURL(selectedFile);

    reader.onloadend = async () => {
        console.log("[UploadPage] reader.onloadend: File read complete.");
        try {
            if (typeof reader.result !== 'string') {
                console.error("[UploadPage] FileReader result is not a string.");
                throw new Error(t('upload_toast_upload_failed_read_desc'));
            }
            const originalBase64Data = reader.result;
            console.log("[UploadPage] Original base64 data obtained. Length (chars):", originalBase64Data.length);
            setUploadProgress(10);

            if (selectedFile.type.startsWith('image/')) {
                setStreamingContent(t('upload_compressing_image'));
                console.log("[UploadPage] Compressing image for AI scan and storage...");
                try {
                    originalImagePreviewDataUri = await compressImage(originalBase64Data, 0.7, 800, 1024);
                    compressedImageForFinalRecordDataUri = await compressImage(originalBase64Data, 0.5, 1024, 1280);
                } catch (compError) {
                    console.warn("[UploadPage] Image compression failed, using original Data URI:", compError);
                    originalImagePreviewDataUri = originalBase64Data;
                    compressedImageForFinalRecordDataUri = originalBase64Data;
                    toast({ title: t('upload_toast_compression_failed_title'), description: `${t('upload_toast_compression_failed_desc')} (${(compError as Error).message})`, variant: 'warning'});
                }
            } else if (selectedFile.type === 'application/pdf') {
                originalImagePreviewDataUri = originalBase64Data;
                compressedImageForFinalRecordDataUri = originalBase64Data; 
                if (originalBase64Data.length > MAX_SCAN_RESULTS_SIZE_BYTES * 1.5) { // ~1.5MB check for PDF Data URI
                    throw new Error(t('upload_toast_pdf_too_large_firestore_error', {size: (originalBase64Data.length / (1024*1024)).toFixed(2)}));
                }
            } else {
                 throw new Error(t('upload_toast_invalid_file_type_desc'));
            }
            setUploadProgress(20);

            setStreamingContent(t('upload_ai_analysis_inprogress'));
            console.log("[UploadPage] Starting AI scan. Document type:", documentType);
            
            const aiInputDataUri = originalImagePreviewDataUri; 

            if (documentType === 'invoice') {
                finalScanResult = await scanTaxInvoice({ invoiceDataUri: aiInputDataUri }, (update) => {
                    if (update && update.content) setStreamingContent(prev => `${t('upload_ai_analysis_inprogress')}... ${update.content}`);
                });
            } else { 
                finalScanResult = await scanInvoice({ invoiceDataUri: aiInputDataUri }, (update) => {
                    if (update && update.content) setStreamingContent(prev => `${t('upload_ai_analysis_inprogress')}... ${update.content}`);
                });
            }
            console.log("[UploadPage] AI scan result received:", finalScanResult);

            if (!finalScanResult || typeof finalScanResult !== 'object') {
                console.error("[UploadPage] AI scan returned invalid result (null, undefined, or not an object).");
                finalScanResult = { error: t('upload_toast_ai_processing_error_desc_generic_server_response') } as any;
            }


            if (finalScanResult && finalScanResult.error) {
                setScanError(finalScanResult.error);
                console.warn("[UploadPage] AI scan returned an error:", finalScanResult.error);
            }
            setUploadProgress(40);

            const scanResultString = JSON.stringify(finalScanResult);
            if (scanResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                const errorMsg = t('upload_toast_scan_results_too_large_error', { size: (scanResultString.length / (1024*1024)).toFixed(2) });
                console.error(`[UploadPage] ${errorMsg}`);
                if (finalScanResult) finalScanResult.error = finalScanResult.error ? `${finalScanResult.error}; ${errorMsg}` : errorMsg;
                else finalScanResult = { error: errorMsg } as any;
                setScanError(finalScanResult.error);
            }
            
            try {
                localStorage.setItem(dataKeyForLocalStorageJson, scanResultString);
                scanDataSavedForLocalStorage = true;
                console.log(`[UploadPage] Scan results JSON saved to localStorage: ${dataKeyForLocalStorageJson}`);
            } catch (storageError: any) {
                console.warn("[UploadPage] Warning: Failed to save scan JSON to localStorage. This is a fallback, proceeding with Firestore.", storageError);
                toast({
                    title: t('upload_toast_storage_full_pending_title'),
                    description: t('upload_toast_storage_full_desc_scan_json', {context: 'scan result JSON', message: storageError.message}),
                    variant: 'warning',
                    duration: 7000
                });
            }
            setUploadProgress(60);

            console.log("[UploadPage] Attempting to create PENDING Firestore document. User ID:", user.id, "DB Initialized:", !!db);
            if (!db || !user || !user.id) {
                console.error("[UploadPage] Firestore (db) or user is not initialized for creating pending document.");
                throw new Error("Database not available or user not authenticated for pending document creation.");
            }

            const pendingInvoiceDocRef = doc(db, DOCUMENTS_COLLECTION, tempInvoiceId);
            const pendingInvoice: Omit<InvoiceHistoryItem, 'id' | 'uploadTime'> & { userId: string, uploadTime: FieldValue } = {
                userId: user.id,
                originalFileName: originalFileName,
                generatedFileName: originalFileName, 
                uploadTime: serverTimestamp(),
                status: finalScanResult?.error ? 'error' : 'pending',
                documentType: documentType,
                supplierName: (documentType === 'invoice' ? (finalScanResult as ScanTaxInvoiceOutput)?.supplierName : (finalScanResult as ScanInvoiceOutput)?.supplier) || null,
                invoiceNumber: (documentType === 'invoice' ? (finalScanResult as ScanTaxInvoiceOutput)?.invoiceNumber : (finalScanResult as ScanInvoiceOutput)?.invoiceNumber) || null,
                totalAmount: (documentType === 'invoice' ? (finalScanResult as ScanTaxInvoiceOutput)?.totalAmount : (finalScanResult as ScanInvoiceOutput)?.totalAmount) ?? null,
                invoiceDate: (documentType === 'invoice' ? (finalScanResult as ScanTaxInvoiceOutput)?.invoiceDate : (finalScanResult as ScanInvoiceOutput)?.invoiceDate) || null,
                paymentMethod: (documentType === 'invoice' ? (finalScanResult as ScanTaxInvoiceOutput)?.paymentMethod : (finalScanResult as ScanInvoiceOutput)?.paymentMethod) || null,
                paymentStatus: 'unpaid',
                paymentDueDate: null,
                errorMessage: finalScanResult?.error || null,
                rawScanResultJson: scanDataSavedForLocalStorage ? scanResultString : null, // Only store if successfully saved to LS as well
                originalImagePreviewUri: originalImagePreviewDataUri,
                compressedImageForFinalRecordUri: compressedImageForFinalRecordDataUri,
                paymentReceiptImageUri: null,
                linkedDeliveryNoteId: null,
            };

            try {
                await setDoc(pendingInvoiceDocRef, pendingInvoice); // No need to sanitize here as we ensured nulls
                pendingFirestoreDocCreated = true;
                console.log(`[UploadPage] Created PENDING Firestore document record ID: ${tempInvoiceId}`);
            } catch (firestoreError: any) {
                 console.error("[UploadPage] Failed to create PENDING Firestore document:", firestoreError);
                 if (finalScanResult) finalScanResult.error = finalScanResult.error ? `${finalScanResult.error}; DB_PENDING_SAVE_FAILED: ${firestoreError.message}` : `DB_PENDING_SAVE_FAILED: ${firestoreError.message}`;
                 else finalScanResult = { error: `DB_PENDING_SAVE_FAILED: ${firestoreError.message}` } as any;
                 setScanError(finalScanResult.error);
                 toast({ title: t('upload_toast_error_pending_record_title'), description: t('upload_toast_error_pending_record_desc', {fileName: originalFileName, message: firestoreError.message }), variant: 'destructive', duration: 7000 });
            }
            setUploadProgress(100);

        } catch (error: any) {
            console.error("[UploadPage] Error in main try block of onloadend:", error);
            const errorMessage = error.message || t('upload_toast_upload_failed_unexpected_desc', { message: 'Unknown error' });
            if (finalScanResult) finalScanResult.error = finalScanResult.error ? `${finalScanResult.error}; MAIN_ERROR: ${errorMessage}` : `MAIN_ERROR: ${errorMessage}`;
            else finalScanResult = { error: `MAIN_ERROR: ${errorMessage}` } as any;
            setScanError(finalScanResult.error);
        } finally {
            console.log("[UploadPage] Entering finally block. pendingFirestoreDocCreated:", pendingFirestoreDocCreated, "scanDataSavedForLocalStorage:", scanDataSavedForLocalStorage, "selectedFile:", !!selectedFile);
            setIsUploading(false);
            setIsProcessing(false);
            setStreamingContent('');

            const queryParams = new URLSearchParams();
            if (selectedFile) queryParams.append('originalFileName', selectedFile.name); // Keep originalFileName for display
            queryParams.append('docType', documentType);
            
            // Navigate if Firestore pending doc was created OR if localStorage save worked (fallback)
            if (pendingFirestoreDocCreated && selectedFile) {
                queryParams.append('tempInvoiceId', tempInvoiceId);
                if (!scanDataSavedForLocalStorage) { // Firestore OK, LS failed (e.g. quota for scan JSON)
                    queryParams.append('localStorageScanDataMissing', 'true');
                }
                let toastDesc = finalScanResult?.error ? finalScanResult.error : t('upload_toast_scan_complete_desc_firestore_pending', { fileName: originalFileName });
                if (!scanDataSavedForLocalStorage && !finalScanResult?.error) {
                    toastDesc += ` ${t('upload_toast_warn_ls_fail')}`;
                }
                toast({ title: finalScanResult?.error ? t('upload_toast_scan_error_title') : t('upload_toast_scan_complete_title'), description: toastDesc, variant: finalScanResult?.error ? 'warning' : 'default', duration: finalScanResult?.error ? 8000 : 5000 });
                console.log("[UploadPage] Navigating to edit-invoice (Firestore pending doc created). Params:", queryParams.toString());
                router.push(`/edit-invoice?${queryParams.toString()}`);

            } else if (scanDataSavedForLocalStorage && selectedFile) { // Firestore pending doc failed, but LS save worked
                queryParams.append('key', dataKeyForLocalStorageJson);
                toast({ title: t('upload_toast_scan_complete_pending_save_failed_title'), description: finalScanResult?.error || t('upload_toast_scan_complete_pending_save_failed_desc', { fileName: originalFileName }), variant: 'warning', duration: 8000 });
                console.warn("[UploadPage] Navigating to edit-invoice with localStorage key (Firestore pending doc failed). Params:", queryParams.toString());
                router.push(`/edit-invoice?${queryParams.toString()}`);
            
            } else if (selectedFile) { // Both failed or critical error before attempting save
                console.error("[UploadPage] Critical failure: Neither Firestore pending doc nor localStorage scan data saved. Cannot navigate. File was:", selectedFile.name, "Final Scan Error:", finalScanResult?.error);
                toast({ title: t('upload_toast_upload_failed_title'), description: finalScanResult?.error || t('upload_toast_processing_failed_desc_generic'), variant: 'destructive', duration: 10000});
            }
            
            if (pendingFirestoreDocCreated || scanDataSavedForLocalStorage) {
                clearSelection();
            }
            fetchHistory(); // Refresh history regardless of individual scan success/failure
            console.log("[UploadPage] Exiting finally block of onloadend.");
        }
    };

    reader.onerror = (errorEvent) => {
        console.error('[UploadPage] FileReader.onerror:', errorEvent);
        setIsUploading(false); setIsProcessing(false); setStreamingContent('');
        setScanError(t('upload_toast_upload_failed_read_desc'));
        toast({ title: t('upload_toast_upload_failed_title'), description: t('upload_toast_upload_failed_read_desc'), variant: 'destructive'});
    };
};


  const formatDateForDisplay = (dateInput: string | Date | Timestamp | undefined) => {
    if (!dateInput) return t('invoices_na');
    try {
        let dateObj: Date | null = null;
        if (dateInput instanceof Timestamp) {
            dateObj = dateInput.toDate();
        } else if (typeof dateInput === 'string') {
            const parsed = parseISO(dateInput);
            if (isValid(parsed)) dateObj = parsed;
        } else if (dateInput instanceof Date && isValid(dateInput)) {
            dateObj = dateInput;
        }

        if (!dateObj || !isValid(dateObj)) {
            console.warn(`[UploadPage formatDateForDisplay] Invalid date object for input:`, dateInput);
            return t('invoices_invalid_date');
        }
        const dateLocale = locale === 'he' ? he : enUS;
        return window.innerWidth < 640
             ? format(dateObj, 'dd/MM/yy HH:mm', { locale: dateLocale })
             : format(dateObj, 'PPp', { locale: dateLocale });
    } catch (e) {
      console.error("[UploadPage formatDateForDisplay] Error formatting date:", e, "Input:", dateInput);
      return t('invoices_invalid_date');
    }
  };

  const handleViewDetails = (invoice: InvoiceHistoryItem) => {
      const detailsToSet: InvoiceHistoryItem & { _displayContext?: 'image_only' | 'full_details' } = {...invoice, _displayContext: 'full_details'};
      setSelectedInvoiceDetails(detailsToSet);
      setShowDetailsModal(true);
  };

  const handleViewImage = (invoice: InvoiceHistoryItem) => {
    const detailsToSet: InvoiceHistoryItem & { _displayContext?: 'image_only' | 'full_details' } = {...invoice, _displayContext: 'image_only'};
    setSelectedInvoiceDetails(detailsToSet);
    setShowDetailsModal(true);
  };

  const renderStatusBadge = (status: InvoiceHistoryItem['status']) => {
      let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
      let className = '';
      let icon = null;

      switch (status) {
          case 'completed':
              variant = 'secondary';
              className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
              icon = <CheckCircle className="mr-1 h-3 w-3" />;
              break;
          case 'processing':
              variant = 'secondary';
              className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
              icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
              break;
          case 'pending':
                variant = 'secondary';
                className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
                icon = <Clock className="mr-1 h-3 w-3" />;
                break;
          case 'error':
              variant = 'destructive';
              icon = <XCircle className="mr-1 h-3 w-3" />;
              break;
          default:
              variant = 'outline';
              icon = null;
              break;
      }
      return (
          <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
              {icon}
              {t(`invoice_status_${status}` as any) || (typeof status === 'string' ? status.charAt(0).toUpperCase() + status.slice(1) : '')}
          </Badge>
      );
  };


  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">{t('loading_data')}</p>
      </div>
    );
  }

  if (!user && !authLoading) {
    return null;
  }

  const formatCurrencyDisplay = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
  ): string => {
      const { decimals = 2, useGrouping = true } = options || {};

      if (value === null || value === undefined || isNaN(value)) {
          const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: useGrouping,
          });
          return `${t('currency_symbol')}${zeroFormatted}`;
      }

      const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: useGrouping,
      });
      return `${t('currency_symbol')}${formattedValue}`;
  };


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
      <Card className="shadow-lg scale-fade-in bg-card/80 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <UploadCloud className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('upload_title')}
          </CardTitle>
          <CardDescription>{t('upload_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={documentType} onValueChange={(value) => setDocumentType(value as 'deliveryNote' | 'invoice')}>
            <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/60 p-1.5 rounded-lg">
              <TabsTrigger value="deliveryNote" className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary py-2 text-sm font-medium">
                {t('upload_doc_type_delivery_note')}
              </TabsTrigger>
              <TabsTrigger value="invoice" className="data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary py-2 text-sm font-medium">
                {t('upload_doc_type_invoice')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="deliveryNote" className="mt-0">
              <p className="text-sm text-muted-foreground mb-2">
                {t('upload_delivery_note_specific_desc')}
              </p>
            </TabsContent>
            <TabsContent value="invoice" className="mt-0">
               <p className="text-sm text-muted-foreground mb-2">
                {t('upload_invoice_specific_desc')}
              </p>
            </TabsContent>
          </Tabs>

        {!selectedFile ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors",
              "bg-muted/20 hover:bg-primary/5",
              isDragging ? "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2" : "border-border hover:border-primary/70"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadCloud className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground mb-2" />
            <p className="text-sm sm:text-base text-muted-foreground">
              {t('upload_drag_drop_text_or')}{' '}
              <span className="font-semibold text-primary hover:underline">{t('upload_browse_files_link')}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t('upload_supported_files_text')}</p>
            <Input
              type="file"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="hidden"
              accept=".jpg,.jpeg,.png,.pdf,.webp,.gif"
              aria-label={t('upload_file_input_aria')}
              disabled={isUploading || isProcessing}
            />
          </div>
           ) : (
             <div className="mt-4 p-3 border rounded-md bg-muted/50">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-sm font-medium text-foreground">{t('upload_selected_file_label')}: {selectedFile.name}</p>
                  <Button variant="ghost" size="icon" onClick={clearSelection} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                    <ClearIcon className="h-4 w-4" />
                    <span className="sr-only">{t('upload_clear_selection_button')}</span>
                  </Button>
                </div>
                {filePreview && !isPdfPreview && (
                  <div className="mt-2 relative w-full max-w-xs h-40 mx-auto">
                    <NextImage src={filePreview} alt={t('upload_preview_alt')} layout="fill" objectFit="contain" data-ai-hint="document preview" />
                  </div>
                )}
                {isPdfPreview && selectedFile && (
                  <div className="mt-2 flex items-center justify-center text-muted-foreground">
                    <FileTextIconLucide className="h-10 w-10 mr-2" />
                    <span>{selectedFile.name} (PDF)</span>
                  </div>
                )}
              </div>
           )}


          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || isProcessing}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-base py-2.5 px-6 text-primary-foreground shadow-md hover:shadow-lg transform hover:scale-105 transition-all"
          >
            {isProcessing ? (
               <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_processing')}</>
            ) : isUploading ? (
               <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_uploading')}</>
            ) : (
              <>{t('upload_button_upload_process')}</>
            )}
          </Button>

          {(isUploading || isProcessing) && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="w-full h-2.5" aria-label={t('upload_progress_aria', {progress: uploadProgress})}/>
              <p className="text-sm text-muted-foreground text-center">
                 {streamingContent || (isProcessing ? t('upload_ai_analysis_inprogress') : t('upload_progress_text', {fileName: selectedFile?.name || 'file'}))}
              </p>
              {isProcessing && streamingContent && !streamingContent.includes(t('upload_ai_analysis_inprogress')) && !streamingContent.includes(t('upload_preparing_file')) && !streamingContent.includes(t('upload_compressing_image')) && (
                <ScrollArea className="h-20 mt-2 p-2 border rounded-md bg-muted/50 text-xs">
                    <pre className="whitespace-pre-wrap">{streamingContent}</pre>
                </ScrollArea>
              )}
            </div>
          )}
           {scanError && !isProcessing && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-md">
              <p><strong>{t('upload_toast_scan_error_title')}:</strong> {scanError}</p>
            </div>
          )}
           <Card className="mt-6 border-border/50 bg-muted/20">
            <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('upload_scanning_tips_title')}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 text-xs text-muted-foreground">
                <ul className="list-disc list-inside space-y-1">
                    <li>{t('upload_tip_lighting')}</li>
                    <li>{t('upload_tip_angle')}</li>
                    <li>{t('upload_tip_full_document')}</li>
                    <li>{t('upload_tip_clear_focus')}</li>
                </ul>
            </CardContent>
           </Card>

        </CardContent>
      </Card>

      <Card className="shadow-lg scale-fade-in delay-200 bg-card/80 backdrop-blur-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
            <Clock className="mr-2 h-4 sm:h-5 w-4 sm:w-5" /> {t('upload_history_title')}
          </CardTitle>
          <CardDescription>{t('upload_history_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
            <div className="flex items-center justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">{t('upload_history_loading')}</span>
            </div>
          ) : uploadHistory.length === 0 ? (
            <p className="text-muted-foreground text-center p-6">{t('upload_history_no_uploads')}</p>
          ) : (
            <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40%] sm:w-[50%] px-2 sm:px-4 py-2">{t('upload_history_col_file_name')}</TableHead>
                      <TableHead className="hidden sm:table-cell px-2 sm:px-4 py-2">{t('upload_history_col_upload_time')}</TableHead>
                      <TableHead className="px-2 sm:px-4 py-2">{t('upload_history_col_status')}</TableHead>
                      <TableHead className="text-right px-2 sm:px-4 py-2">{t('upload_history_col_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploadHistory.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium truncate max-w-[150px] sm:max-w-xs px-2 sm:px-4 py-2" title={item.originalFileName || item.generatedFileName}>
                           <Button variant="link" className="p-0 h-auto text-left font-medium text-foreground hover:text-primary truncate" onClick={() => handleViewImage(item)}>
                             {(item.originalImagePreviewUri || item.compressedImageForFinalRecordUri) && <ImageIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
                              {item.originalFileName || item.generatedFileName}
                           </Button>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell px-2 sm:px-4 py-2">{formatDateForDisplay(item.uploadTime)}</TableCell>
                        <TableCell className="px-2 sm:px-4 py-2">{renderStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2 space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => handleViewDetails(item)} className="h-8 w-8" title={t('upload_history_view_details_title', {fileName: item.originalFileName || item.generatedFileName || ''})} aria-label={t('upload_history_view_details_aria', {fileName: item.originalFileName || item.generatedFileName || ''})}>
                            <Info className="h-4 w-4 text-primary" />
                          </Button>
                          {(item.status === 'pending' || item.status === 'error') && user && user.id && item.id && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    if (!item.id) {
                                        toast({title: t('upload_retry_unavailable_title'), description: t('upload_retry_unavailable_desc'), variant: "destructive"});
                                        return;
                                    }
                                    const queryParams = new URLSearchParams({
                                        tempInvoiceId: item.id,
                                        docType: item.documentType,
                                        originalFileName: encodeURIComponent(item.originalFileName || 'unknown_doc'),
                                    });
                                    router.push(`/edit-invoice?${queryParams.toString()}`);
                                }}
                                className="h-8 w-8"
                                title={t('upload_history_retry_upload_title')}
                                aria-label={t('upload_history_retry_upload_aria', {fileName: item.originalFileName || item.generatedFileName || ''})}
                            >
                                <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDetailsModal} onOpenChange={(open) => {
          setShowDetailsModal(open);
          if (!open) {
            setSelectedInvoiceDetails(null);
          }
      }}>
        <DialogContent className="max-w-xs sm:max-w-md md:max-w-lg lg:max-w-xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-4 sm:p-6 border-b shrink-0 sticky top-0 bg-background z-10">
            <DialogTitle>{selectedInvoiceDetails?._displayContext === 'image_only' ? t('upload_history_image_preview_title') : t('invoice_details_title')}</DialogTitle>
            {selectedInvoiceDetails?._displayContext !== 'image_only' && (
                <DialogDescription>
                {t('invoice_details_description', { fileName: selectedInvoiceDetails?.originalFileName || selectedInvoiceDetails?.generatedFileName || '' })}
                </DialogDescription>
            )}
          </DialogHeader>
          {selectedInvoiceDetails && (
             <ScrollArea className="flex-grow p-0">
              <div className="p-4 sm:p-6 space-y-4">
                  {selectedInvoiceDetails._displayContext === 'image_only' || !selectedInvoiceDetails._displayContext ? (
                     <>
                      {isValidImageSrc(selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri) ? (
                        <NextImage
                            src={selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri!}
                            alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName || '' })}
                            width={800}
                            height={1100}
                            className="rounded-md object-contain mx-auto"
                            data-ai-hint="invoice document"
                        />
                        ) : (
                          <div className="text-muted-foreground text-center py-4 flex flex-col items-center">
                            <ImageIconLucide className="h-10 w-10 mb-2"/>
                            <p>{t('invoice_details_no_image_available')}</p>
                          </div>
                        )}
                     </>
                  ) : null }

                  {selectedInvoiceDetails._displayContext === 'full_details' && (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div>
                            <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName}</p>
                            <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.uploadTime)}</p>
                            <div className="flex items-center">
                                <strong className="mr-1">{t('invoice_details_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.status)}
                            </div>
                             <div className="flex items-center mt-1">
                                <strong className="mr-1">{t('invoice_payment_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.paymentStatus as InvoiceHistoryItem['status'], 'payment')}
                            </div>
                            </div>
                            <div>
                            <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                            <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplierName || t('invoices_na')}</p>
                            <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatCurrencyDisplay(selectedInvoiceDetails.totalAmount) : t('invoices_na')}</p>
                            <p><strong>{t('invoice_details_invoice_date_label')}:</strong> {selectedInvoiceDetails.invoiceDate ? formatDateForDisplay(selectedInvoiceDetails.invoiceDate) : t('invoices_na')}</p>
                            <p><strong>{t('invoice_details_payment_method_label')}:</strong> {selectedInvoiceDetails.paymentMethod || t('invoices_na')}</p>
                             {selectedInvoiceDetails.paymentDueDate && (
                                <p><strong>{t('payment_due_date_dialog_title')}:</strong> {formatDateForDisplay(selectedInvoiceDetails.paymentDueDate)}</p>
                             )}
                            </div>
                        </div>
                        {selectedInvoiceDetails.errorMessage && (
                            <div className="mt-2">
                            <p className="font-semibold text-destructive">{t('invoice_details_error_message_label')}:</p>
                            <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                            </div>
                        )}
                         <Separator className="my-4"/>
                         <div className="overflow-auto max-h-[calc(85vh-320px)] sm:max-h-[calc(90vh-350px)]">
                         {isValidImageSrc(selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri) ? (
                            <NextImage
                                src={selectedInvoiceDetails.originalImagePreviewUri || selectedInvoiceDetails.compressedImageForFinalRecordUri!}
                                alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.originalFileName || selectedInvoiceDetails.generatedFileName || '' })}
                                width={800}
                                height={1100}
                                className="rounded-md object-contain mx-auto"
                                data-ai-hint="invoice document"
                            />
                            ) : (
                            <div className="text-muted-foreground text-center py-4 flex flex-col items-center">
                                <ImageIconLucide className="h-10 w-10 mb-2"/>
                                <p>{t('invoice_details_no_image_available')}</p>
                            </div>
                            )}
                        </div>
                    </>
                  )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
