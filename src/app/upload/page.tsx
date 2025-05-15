
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
import type { ScanInvoiceOutput } from '@/ai/flows/scan-invoice';
import { scanTaxInvoice } from '@/ai/flows/scan-tax-invoice';
import type { ScanTaxInvoiceOutput } from '@/ai/flows/tax-invoice-schemas';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText as FileTextIconLucide, Clock, CheckCircle, XCircle, Loader2, Image as ImageIconLucide, Info, Edit } from 'lucide-react';
import {
    InvoiceHistoryItem,
    getInvoicesService,
    TEMP_DATA_KEY_PREFIX,
    TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX,
    TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
    MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES,
    MAX_SCAN_RESULTS_SIZE_BYTES,
    clearTemporaryScanData,
    INVOICES_STORAGE_KEY_BASE,
    MAX_INVOICE_HISTORY_ITEMS,
    getStorageKey,
    finalizeSaveProductsService,
} from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, isValid } from 'date-fns';
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

async function compressImage(base64Str: string, quality = 0.6, maxWidth = 1024, maxHeight = 1024): Promise<string> {
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
                return reject(new Error('Failed to get canvas context'));
            }
            ctx.drawImage(img, 0, 0, width, height);
            const mimeType = base64Str.substring(base64Str.indexOf(':') + 1, base64Str.indexOf(';'));
            const outputMimeType = (mimeType === 'image/png') ? 'image/png' : 'image/jpeg';
            resolve(canvas.toDataURL(outputMimeType, quality));
        };
        img.onerror = (error) => {
            console.error("Image load error for compression:", error);
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
    if (!user || !user.id) return; // Ensure user.id exists
    setIsLoadingHistory(true);
    try {
      const invoices = await getInvoicesService(user.id); // Pass userId
      setUploadHistory(invoices.sort((a,b) => {
        const timeA = a.uploadTime ? (typeof a.uploadTime === 'string' ? parseISO(a.uploadTime) : a.uploadTime instanceof Timestamp ? a.uploadTime.toDate() : new Date(0)).getTime() : 0;
        const timeB = b.uploadTime ? (typeof b.uploadTime === 'string' ? parseISO(b.uploadTime) : b.uploadTime instanceof Timestamp ? b.uploadTime.toDate() : new Date(0)).getTime() : 0;
        return timeB - timeA;
      }).slice(0, 10));
    } catch (error) {
      console.error("Failed to load upload history:", error);
      toast({
        title: t('upload_toast_history_load_fail_title'),
        description: t('upload_toast_history_load_fail_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [toast, t, user]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    } else if (user && user.id) { // Ensure user.id exists
      fetchHistory();
    }
  }, [user, authLoading, router, fetchHistory]);


  const processFileForPreview = (file: File) => {
    setSelectedFile(file);
    setScanError(null);
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
      if (validTypes.includes(file.type)) {
        processFileForPreview(file);
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        setFilePreview(null);
        setIsPdfPreview(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
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
      if (validTypes.includes(file.type)) {
         processFileForPreview(file);
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        setFilePreview(null);
        setIsPdfPreview(false);
      }
    }
  };


  const handleUpload = async () => {
    if (!selectedFile || !user || !user.id) return; // Ensure user.id exists

    setIsUploading(true);
    setIsProcessing(true);
    setUploadProgress(0);
    setStreamingContent(t('upload_preparing_file'));
    setScanError(null);

    const originalFileName = selectedFile.name;
    const reader = new FileReader();
    let progressInterval: NodeJS.Timeout | undefined = undefined;

    const uniqueScanId = `${Date.now()}_${originalFileName.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const tempInvoiceId = `pending-inv-${user.id}_${uniqueScanId}`; // Include userId in tempId

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${user.id}_${uniqueScanId}`;
    const originalImagePreviewKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${user.id}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${user.id}_${uniqueScanId}`;

    let scanDataSavedForEdit = false;
    let originalImagePreviewUriSaved = false;
    let compressedImageForFinalSaveUriSaved = false;
    let scanResult: ScanInvoiceOutput | ScanTaxInvoiceOutput | null = null;


    try {
       let currentProgress = 0;
       progressInterval = setInterval(() => {
         currentProgress += 10;
         if (currentProgress <= 100) {
           setUploadProgress(currentProgress);
         } else {
           if(progressInterval) clearInterval(progressInterval);
         }
       }, 150);

       reader.readAsDataURL(selectedFile);
       reader.onloadend = async () => {
           if(progressInterval) clearInterval(progressInterval);
           setUploadProgress(100);
            setStreamingContent(t('upload_compressing_image'));


           if (typeof reader.result !== 'string') {
             console.error("FileReader did not return a string result.");
             toast({ title: t('upload_toast_upload_failed_title'), description: t('upload_toast_upload_failed_read_desc'), variant: 'destructive' });
             setIsProcessing(false); setIsUploading(false);
             clearTemporaryScanData(uniqueScanId, user.id); // Pass userId
             return;
           }

           const originalBase64Data = reader.result;
           let imageForAIScan = originalBase64Data;
           let imageForPreviewOnEditPage = originalBase64Data;
           let imageToStoreForFinalSave: string | undefined = undefined;

            try {
                if(selectedFile.type.startsWith('image/')) {
                  imageToStoreForFinalSave = await compressImage(originalBase64Data);
                  if (imageToStoreForFinalSave.length < (originalBase64Data.length * 0.8)) {
                      imageForAIScan = imageToStoreForFinalSave;
                  }
                } else { // For PDFs, use original as compressed (no actual compression here)
                    imageToStoreForFinalSave = originalBase64Data;
                }

                if (imageToStoreForFinalSave && imageToStoreForFinalSave.length > MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    console.warn(`[UploadPage] Compressed image for final save (${(imageToStoreForFinalSave.length / (1024*1024)).toFixed(2)}MB) exceeds limit (${(MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES / (1024*1024)).toFixed(2)}MB). Not saving it.`);
                    imageToStoreForFinalSave = undefined;
                }

                if (imageToStoreForFinalSave) {
                    try {
                       localStorage.setItem(compressedImageKey, imageToStoreForFinalSave);
                       compressedImageForFinalSaveUriSaved = true;
                    } catch (storageError: any) {
                       console.warn(`[UploadPage] Failed to save compressed image for final save to localStorage (key: ${compressedImageKey}):`, storageError.message);
                        toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(compressed final save)"}), variant: 'destructive', duration: 8000 });
                        compressedImageForFinalSaveUriSaved = false;
                    }
                }

                if (originalBase64Data.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = originalBase64Data;
                } else if (imageToStoreForFinalSave && imageToStoreForFinalSave.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = imageToStoreForFinalSave;
                } else {
                    imageForPreviewOnEditPage = '';
                    console.warn("[UploadPage] Image too large for preview on edit page even after compression attempts.");
                }


            } catch (compressionError) {
                console.warn("[UploadPage] Image compression failed, will use original for AI and potentially preview:", compressionError);
                setStreamingContent(t('upload_compression_failed_using_original'));
                if (originalBase64Data.length > MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = '';
                }
            }

            if (imageForPreviewOnEditPage) {
                try {
                    localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                    originalImagePreviewUriSaved = true;
                } catch (storageError: any) {
                    console.warn(`[UploadPage] Failed to save original image preview to localStorage (key: ${originalImagePreviewKey}):`, storageError.message);
                    originalImagePreviewUriSaved = false;
                    toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(original preview)"}), variant: 'destructive', duration: 8000 });
                }
            }
            setStreamingContent(t('upload_ai_analysis_inprogress'));

           if (documentType === 'invoice') {
               try {
                   scanResult = await scanTaxInvoice({ invoiceDataUri: imageForAIScan });
                   if (scanResult.error) {
                       console.error("[UploadPage] AI tax invoice processing returned an error:", scanResult.error);
                       toast({ title: t('upload_toast_scan_error_title'), description: t('upload_toast_scan_error_desc', { error: scanResult.error }), variant: 'destructive', duration: 8000 });
                       setScanError(scanResult.error);
                   }
               } catch (aiError: any) {
                    const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error')});
                    toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
                    scanResult = { error: errorMessage };
                    setScanError(errorMessage);
               }
           } else {
               try {
                   scanResult = await scanInvoice({ invoiceDataUri: imageForAIScan }, (update) => setStreamingContent(prev => `${t('upload_ai_analysis_inprogress')}... ${update.content}`));
                   if (scanResult.error) {
                       console.error("[UploadPage] AI product processing returned an error:", scanResult.error);
                       toast({ title: t('upload_toast_scan_error_title'), description: t('upload_toast_scan_error_desc', { error: scanResult.error }), variant: 'destructive', duration: 8000 });
                       setScanError(scanResult.error);
                   }
               } catch (aiError: any) {
                    const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error') });
                    toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
                    scanResult = { products: [], error: errorMessage };
                    setScanError(errorMessage);
               }
           }
           setIsProcessing(false);
           setStreamingContent('');


            try {
                if (!scanResult) throw new Error("Scan result is null or undefined after AI call.");
                const scanResultString = JSON.stringify(scanResult);
                if (scanResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                    const errorMsg = t('upload_toast_scan_results_too_large_error', { size: (scanResultString.length / (1024*1024)).toFixed(2) });
                     if (documentType === 'invoice') {
                        scanResult = { error: errorMsg } as ScanTaxInvoiceOutput;
                    } else {
                        scanResult = { products: [], error: errorMsg } as ScanInvoiceOutput;
                    }
                    localStorage.setItem(dataKey, JSON.stringify(scanResult));
                    scanDataSavedForEdit = true;
                    setScanError(errorMsg);
                    toast({ title: t('upload_toast_critical_error_save_scan_title'), description: errorMsg, variant: 'destructive', duration: 10000 });
                } else {
                    localStorage.setItem(dataKey, JSON.stringify(scanResult));
                    scanDataSavedForEdit = true;
                }
            } catch (storageError: any) {
                 console.error(`[UploadPage] Error saving scan results to localStorage for key ${dataKey}:`, storageError);
                 toast({
                     title: t('upload_toast_critical_error_save_scan_title'),
                     description: t('upload_toast_critical_error_save_scan_desc', { message: storageError.message }),
                     variant: 'destructive',
                     duration: 10000,
                 });
                 clearTemporaryScanData(uniqueScanId, user.id); // Pass userId
                 setIsProcessing(false); setIsUploading(false); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fetchHistory();
                 return;
            }


           if (!scanResult?.error && scanDataSavedForEdit) {
               toast({
                 title: t('upload_toast_scan_complete_title'),
                 description: t('upload_toast_scan_complete_desc', { fileName: originalFileName }),
               });
           }

            if (scanDataSavedForEdit) {
                const queryParams = new URLSearchParams({
                    key: dataKey,
                    fileName: encodeURIComponent(originalFileName),
                    tempInvoiceId: tempInvoiceId,
                    docType: documentType,
                });
                if (originalImagePreviewUriSaved && localStorage.getItem(originalImagePreviewKey)) queryParams.append('originalImagePreviewKey', originalImagePreviewKey);
                if (compressedImageForFinalSaveUriSaved && localStorage.getItem(compressedImageKey)) queryParams.append('compressedImageKey', compressedImageKey);

                // Logic to create a "pending" InvoiceHistoryItem in localStorage
                // This item will be updated/finalized on the edit-invoice page
                try {
                     const invoicesStorageKey = getStorageKey(INVOICES_STORAGE_KEY_BASE, user.id); // Use user-specific key
                     let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(invoicesStorageKey) || '[]');
                     const pendingInvoice: InvoiceHistoryItem = {
                        id: tempInvoiceId, // Use the generated temp ID
                        userId: user.id, // Associate with user
                        fileName: originalFileName, // Use originalFileName for display initially
                        generatedFileName: originalFileName, // Will be updated on save
                        uploadTime: new Date().toISOString(),
                        status: 'pending', // Initial status
                        documentType: documentType,
                        originalImagePreviewUri: originalImagePreviewUriSaved ? localStorage.getItem(originalImagePreviewKey) || undefined : undefined,
                        compressedImageForFinalRecordUri: compressedImageForFinalSaveUriSaved ? localStorage.getItem(compressedImageKey) || undefined : undefined,
                        invoiceNumber: (scanResult as ScanTaxInvoiceOutput)?.invoiceNumber || (scanResult as ScanInvoiceOutput)?.invoiceNumber,
                        supplierName: (scanResult as ScanTaxInvoiceOutput)?.supplierName || (scanResult as ScanInvoiceOutput)?.supplier,
                        totalAmount: (scanResult as ScanTaxInvoiceOutput)?.totalAmount || (scanResult as ScanInvoiceOutput)?.totalAmount,
                        paymentStatus: 'unpaid', // Default for new uploads
                        invoiceDate: (scanResult as ScanTaxInvoiceOutput)?.invoiceDate || (scanResult as ScanInvoiceOutput)?.invoiceDate,
                        paymentMethod: (scanResult as ScanTaxInvoiceOutput)?.paymentMethod || (scanResult as ScanInvoiceOutput)?.paymentMethod,
                        errorMessage: scanResult?.error
                    };
                    currentInvoices = [pendingInvoice, ...currentInvoices];
                    if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
                        currentInvoices.sort((a,b) => {
                           const timeA = a.uploadTime ? new Date(a.uploadTime as string).getTime() : 0;
                           const timeB = b.uploadTime ? new Date(b.uploadTime as string).getTime() : 0;
                           return timeB - timeA;
                        });
                        currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
                    }
                   localStorage.setItem(invoicesStorageKey, JSON.stringify(currentInvoices));
                   fetchHistory();
                } catch (e: any) {
                    console.error("[UploadPage] Failed to create PENDING invoice record in localStorage:", e);
                    if (e.name === 'QuotaExceededError') {
                        toast({ title: t('upload_toast_storage_full_pending_title'), description: t('upload_toast_storage_full_pending_desc', { fileName: originalFileName }), variant: 'destructive', duration: 10000});
                    } else {
                        toast({ title: t('upload_toast_error_pending_record_title'), description: t('upload_toast_error_pending_record_desc', {fileName: originalFileName, message: e.message}), variant: 'destructive', duration: 8000 });
                    }
                    // Do not proceed to edit page if pending record couldn't be saved
                    setIsProcessing(false); setIsUploading(false); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fetchHistory();
                    return;
                }

                router.push(`/edit-invoice?${queryParams.toString()}`);
            } else {
                console.error("[UploadPage] Temporary data (scan result and/or images) was not saved correctly, aborting navigation to edit page.");
                if (!scanError && !scanResult?.error) {
                    setScanError(t('upload_toast_processing_failed_desc_generic'));
                    toast({
                       title: t('upload_toast_processing_failed_title'),
                       description: t('upload_toast_processing_failed_desc_generic'),
                       variant: "destructive",
                    });
                }
                 setIsProcessing(false); setIsUploading(false); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fetchHistory();
            }
           setIsUploading(false);
       };

     reader.onerror = async (error) => {
       console.error('[UploadPage] Error reading file:', error);
       if(progressInterval) clearInterval(progressInterval);
       setIsUploading(false);
       setIsProcessing(false);
       toast({
         title: t('upload_toast_upload_failed_title'),
         description: t('upload_toast_upload_failed_read_desc'),
         variant: 'destructive',
       });
       clearTemporaryScanData(uniqueScanId, user.id); // Pass userId
     };

  } catch (error) {
     console.error('[UploadPage] File reading setup failed:', error);
     if(progressInterval) clearInterval(progressInterval);
     setIsUploading(false);
     setIsProcessing(false);
     toast({
       title: t('upload_toast_upload_failed_title'),
       description: t('upload_toast_upload_failed_unexpected_desc', { message: (error as Error).message }),
       variant: 'destructive',
     });
     clearTemporaryScanData(uniqueScanId, user.id); // Pass userId
   }
};


  const formatDate = (dateString: string | Date | Timestamp | undefined) => {
    if (!dateString) return t('invoices_na');
    try {
        const dateObj = typeof dateString === 'string' ? parseISO(dateString) : (dateString instanceof Timestamp ? dateString.toDate() : dateString);
        if (!dateObj || !isValid(dateObj)) { // Check if dateObj is null or invalid
            console.warn(`[UploadPage formatDate] Invalid date object for input:`, dateString);
            return t('invoices_invalid_date');
        }
        const dateLocale = locale === 'he' ? he : enUS;
        return window.innerWidth < 640
             ? format(dateObj, 'dd/MM/yy', { locale: dateLocale })
             : format(dateObj, 'PPp', { locale: dateLocale });
    } catch (e) {
      console.error("[UploadPage formatDate] Error formatting date:", e, "Input:", dateString);
      return t('invoices_invalid_date');
    }
  };

  const handleViewDetails = (invoice: InvoiceHistoryItem) => {
      setSelectedInvoiceDetails(invoice);
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

  if (!user && !authLoading) { // Check if user is null only after authLoading is false
    return null; // Or a redirect to login, or a message
  }

  const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    tFunc: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean }
  ): string => {
      const { decimals = 2, useGrouping = true } = options || {};

      if (value === null || value === undefined || isNaN(value)) {
          const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: useGrouping,
          });
          return `${tFunc('currency_symbol')}${zeroFormatted}`;
      }

      const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: useGrouping,
      });
      return `${tFunc('currency_symbol')}${formattedValue}`;
  };


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
      <Card className="shadow-lg scale-fade-in">
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

          {selectedFile && (
            <div className="mt-4 p-3 border rounded-md bg-muted/50">
              <p className="text-sm font-medium text-foreground">{t('upload_selected_file_label')}: {selectedFile.name}</p>
              {filePreview && !isPdfPreview && (
                <div className="mt-2 relative w-full max-w-xs h-40 mx-auto">
                  <NextImage src={filePreview} alt={t('upload_preview_alt')} layout="fill" objectFit="contain" data-ai-hint="document preview" />
                </div>
              )}
              {isPdfPreview && (
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

      <Card className="shadow-lg scale-fade-in delay-200">
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
                        <TableCell className="font-medium truncate max-w-[150px] sm:max-w-xs px-2 sm:px-4 py-2" title={item.fileName}>
                           {item.originalImagePreviewUri && <ImageIconLucide className="inline-block mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
                            {item.fileName}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell px-2 sm:px-4 py-2">{formatDate(item.uploadTime)}</TableCell>
                        <TableCell className="px-2 sm:px-4 py-2">{renderStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2 space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => handleViewDetails(item)} className="h-8 w-8" title={t('upload_history_view_details_title', {fileName: item.fileName})} aria-label={t('upload_history_view_details_aria', {fileName: item.fileName})}>
                            <Info className="h-4 w-4 text-primary" />
                          </Button>
                          {(item.status === 'pending' || item.status === 'error') && user && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    if (!user?.id) return;
                                    const uniqueScanId = item.id.replace(`pending-inv-${user.id}_`, ''); // Use user.id
                                    const queryParams = new URLSearchParams({
                                        key: `${TEMP_DATA_KEY_PREFIX}${user.id}_${uniqueScanId}`,
                                        fileName: encodeURIComponent(item.fileName),
                                        tempInvoiceId: item.id,
                                        docType: item.documentType,
                                    });
                                    if (item.originalImagePreviewUri) queryParams.append('originalImagePreviewKey', `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${user.id}_${uniqueScanId}`);
                                    if (item.compressedImageForFinalRecordUri) queryParams.append('compressedImageKey',`${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${user.id}_${uniqueScanId}`);

                                    router.push(`/edit-invoice?${queryParams.toString()}`);
                                }}
                                className="h-8 w-8"
                                title={t('edit_invoice_button_title')}
                                aria-label={t('edit_invoice_button_aria', {fileName: item.fileName})}
                            >
                                <Edit className="h-4 w-4 text-amber-600 dark:text-amber-500" />
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

      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-xs sm:max-w-md md:max-w-lg lg:max-w-xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-4 sm:p-6 border-b">
            <DialogTitle>{t('invoice_details_title')}</DialogTitle>
            <DialogDescription>
              {t('invoice_details_description', { fileName: selectedInvoiceDetails?.fileName || '' })}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetails && (
             <ScrollArea className="flex-grow p-0">
              <div className="p-4 sm:p-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>{t('invoice_details_file_name_label')}:</strong> {selectedInvoiceDetails.fileName}</p>
                      <p><strong>{t('invoice_details_upload_time_label')}:</strong> {formatDate(selectedInvoiceDetails.uploadTime)}</p>
                      <div className="flex items-center">
                        <strong className="mr-1">{t('invoice_details_status_label')}:</strong> {renderStatusBadge(selectedInvoiceDetails.status)}
                      </div>
                    </div>
                    <div>
                      <p><strong>{t('invoice_details_invoice_number_label')}:</strong> {selectedInvoiceDetails.invoiceNumber || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplierName || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatDisplayNumberWithTranslation(selectedInvoiceDetails.totalAmount, t, { useGrouping: true }) : t('invoices_na')}</p>
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
                        alt={t('invoice_details_image_alt', { fileName: selectedInvoiceDetails.fileName })}
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
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
