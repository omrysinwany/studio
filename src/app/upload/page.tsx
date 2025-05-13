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
import { UploadCloud, FileText as FileTextIconLucide, Clock, CheckCircle, XCircle, Loader2, Image as ImageIconLucide, Info } from 'lucide-react';
import {
    InvoiceHistoryItem,
    getInvoicesService,
    TEMP_DATA_KEY_PREFIX,
    TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX,
    MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES,
    MAX_SCAN_RESULTS_SIZE_BYTES,
    clearTemporaryScanData,
    INVOICES_STORAGE_KEY_BASE,
    MAX_INVOICE_HISTORY_ITEMS,
    getStorageKey,
    finalizeSaveProductsService,
    TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
} from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Helper to check if a string is a valid data URI or URL for NextImage
const isValidImageSrc = (src: string | undefined): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};

// Image compression function (browser-side)
async function compressImage(base64Str: string, quality = 0.7, maxWidth = 1024, maxHeight = 1024): Promise<string> {
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
            const outputMimeType = (mimeType === 'image/png') ? 'image/png' : 'image/jpeg'; // Prefer JPEG for better compression unless original is PNG
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
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const invoices = await getInvoicesService(user.id);
      setUploadHistory(invoices.slice(0, 10)); // Show last 10
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
    } else if (user) {
      fetchHistory();
    }
  }, [user, authLoading, router, fetchHistory]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (validTypes.includes(file.type)) {
        setSelectedFile(file);
        setScanError(null); // Clear previous errors
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Reset file input
        }
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !user) return;

    setIsUploading(true);
    setIsProcessing(true);
    setUploadProgress(0);
    setStreamingContent('');
    setScanError(null);

    const originalFileName = selectedFile.name;
    const reader = new FileReader();
    let progressInterval: NodeJS.Timeout | undefined = undefined;

    const uniqueScanId = `${Date.now()}_${originalFileName.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const tempInvoiceId = `pending-inv-${user.id}_${uniqueScanId}`;

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

           if (typeof reader.result !== 'string') {
             console.error("FileReader did not return a string result.");
             toast({ title: t('upload_toast_upload_failed_title'), description: "Failed to read file data.", variant: 'destructive' });
             setIsProcessing(false); setIsUploading(false);
             return;
           }

           const originalBase64Data = reader.result;
           let imageForAIScan = originalBase64Data;
           let imageForPreviewOnEditPage = originalBase64Data;
           let imageToStoreForFinalSave: string | undefined = undefined;

            try {
                imageToStoreForFinalSave = await compressImage(originalBase64Data);
                console.log(`[UploadPage] Image compressed for final save. Original size: ${originalBase64Data.length}, Compressed size: ${imageToStoreForFinalSave.length}`);

                const useCompressedForAIScan = imageToStoreForFinalSave.length < (originalBase64Data.length * 0.8);
                if (useCompressedForAIScan) {
                    imageForAIScan = imageToStoreForFinalSave;
                    console.log("[UploadPage] Using compressed image for AI scan.");
                }

                const canUseCompressedForPreview = imageToStoreForFinalSave.length < originalBase64Data.length && imageToStoreForFinalSave.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES;
                if (canUseCompressedForPreview) {
                    imageForPreviewOnEditPage = imageToStoreForFinalSave;
                    console.log("[UploadPage] Using compressed image for edit page preview as well.");
                } else if (originalBase64Data.length > MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = '';
                    console.warn("[UploadPage] Original and compressed images are too large for preview storage.");
                }


                if (imageToStoreForFinalSave) {
                    try {
                       localStorage.setItem(compressedImageKey, imageToStoreForFinalSave);
                       compressedImageForFinalSaveUriSaved = true;
                       console.log(`[UploadPage] Image URI for final save stored with key: ${compressedImageKey}`);
                    } catch (storageError: any) {
                       console.warn(`[UploadPage] Failed to save compressed image to localStorage (key: ${compressedImageKey}):`, storageError.message);
                        toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(compressed final save)"}), variant: 'destructive', duration: 8000 });
                    }
                } else {
                    console.warn(`[UploadPage] Compressed image for final save is undefined or empty. Not storing.`);
                }

            } catch (compressionError) {
                console.warn("[UploadPage] Image compression failed, will use original for AI and potentially preview:", compressionError);
                if (originalBase64Data.length > MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = '';
                    console.warn("[UploadPage] Original image (compression failed) is too large for preview storage.");
                }
            }

            if (imageForPreviewOnEditPage) {
                try {
                    localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                    originalImagePreviewUriSaved = true;
                    console.log(`[UploadPage] Image for preview on edit page saved with key: ${originalImagePreviewKey}`);
                } catch (storageError: any) {
                    console.warn(`[UploadPage] Failed to save original image preview to localStorage (key: ${originalImagePreviewKey}):`, storageError.message);
                    originalImagePreviewUriSaved = false;
                    toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(original preview)"}), variant: 'destructive', duration: 8000 });
                }
            } else {
                console.log("[UploadPage] No preview image will be stored (either too large or compression failed).");
            }


           if (documentType === 'invoice') {
               try {
                   console.log("[UploadPage] Calling AI to scan TAX INVOICE...");
                   const aiResponse = await scanTaxInvoice({ invoiceDataUri: imageForAIScan });
                   scanResult = aiResponse;
                   if (aiResponse.error) {
                       console.error("[UploadPage] AI tax invoice processing returned an error:", aiResponse.error);
                       toast({ title: t('upload_toast_scan_error_title'), description: t('upload_toast_scan_error_desc', { error: aiResponse.error }), variant: 'destructive', duration: 8000 });
                       setScanError(aiResponse.error);
                   }
               } catch (aiError: any) {
                    console.error('[UploadPage] AI tax invoice processing failed:', aiError);
                    const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error') });
                    toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
                    scanResult = { error: errorMessage };
                    setScanError(errorMessage);
               }
           } else {
               try {
                   console.log("[UploadPage] Calling AI to scan DELIVERY NOTE (products)...");
                   const aiResponse = await scanInvoice({ invoiceDataUri: imageForAIScan });
                   scanResult = aiResponse;
                   if (aiResponse.error) {
                       console.error("[UploadPage] AI product processing returned an error:", aiResponse.error);
                       toast({ title: t('upload_toast_scan_error_title'), description: t('upload_toast_scan_error_desc', { error: aiResponse.error }), variant: 'destructive', duration: 8000 });
                       setScanError(aiResponse.error);
                   }
               } catch (aiError: any) {
                    console.error('[UploadPage] AI product processing failed:', aiError);
                    const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error') });
                    toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
                    scanResult = { products: [], error: errorMessage };
                    setScanError(errorMessage);
               }
           }
           setIsProcessing(false);


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
                 console.log(`[UploadPage] Scan result (or error) saved to localStorage with key: ${dataKey}`);
            } catch (storageError: any) {
                 console.error(`[UploadPage] Error saving scan results to localStorage for key ${dataKey}:`, storageError);
                 toast({
                     title: t('upload_toast_critical_error_save_scan_title'),
                     description: t('upload_toast_critical_error_save_scan_desc', { message: storageError.message }),
                     variant: 'destructive',
                     duration: 10000,
                 });
                 clearTemporaryScanData(uniqueScanId, user.id);
                 setIsProcessing(false); setIsUploading(false); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fetchHistory();
                 return;
            }

           const pendingInvoice: InvoiceHistoryItem = {
               id: tempInvoiceId,
               fileName: originalFileName,
               uploadTime: new Date().toISOString(),
               status: 'pending',
               paymentStatus: 'unpaid',
               originalImagePreviewUri: originalImagePreviewUriSaved ? localStorage.getItem(originalImagePreviewKey) || undefined : undefined,
               compressedImageForFinalRecordUri: compressedImageForFinalSaveUriSaved ? localStorage.getItem(compressedImageKey) || undefined : undefined,
               invoiceNumber: (scanResult as ScanTaxInvoiceOutput)?.invoiceNumber || (scanResult as ScanInvoiceOutput)?.invoiceNumber,
               supplier: (scanResult as ScanTaxInvoiceOutput)?.supplierName || (scanResult as ScanInvoiceOutput)?.supplier,
               totalAmount: (scanResult as ScanTaxInvoiceOutput)?.totalAmount || (scanResult as ScanInvoiceOutput)?.totalAmount,
               invoiceDate: (scanResult as ScanTaxInvoiceOutput)?.invoiceDate,
               paymentMethod: (scanResult as ScanTaxInvoiceOutput)?.paymentMethod,
           };

           try {
               const invoicesStorageKey = getStorageKey(INVOICES_STORAGE_KEY_BASE, user.id);
               let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(invoicesStorageKey) || '[]');
               currentInvoices = [pendingInvoice, ...currentInvoices];
               if (currentInvoices.length > MAX_INVOICE_HISTORY_ITEMS) {
                   currentInvoices.sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
                   currentInvoices = currentInvoices.slice(0, MAX_INVOICE_HISTORY_ITEMS);
               }
               localStorage.setItem(invoicesStorageKey, JSON.stringify(currentInvoices));
               console.log(`[UploadPage] Created PENDING invoice record ID: ${tempInvoiceId}`);
               fetchHistory();
            } catch (e: any) {
               console.error("[UploadPage] Failed to create PENDING invoice record in localStorage:", e);
                if (e.name === 'QuotaExceededError') {
                    toast({ title: t('upload_toast_storage_full_pending_title'), description: t('upload_toast_storage_full_pending_desc', { fileName: originalFileName }), variant: 'destructive', duration: 10000});
                }
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

                if (originalImagePreviewUriSaved && imageForPreviewOnEditPage) queryParams.append('originalImagePreviewKey', originalImagePreviewKey);
                if (compressedImageForFinalSaveUriSaved && imageToStoreForFinalSave) queryParams.append('compressedImageKey', compressedImageKey);

                router.push(`/edit-invoice?${queryParams.toString()}`);
            } else {
                console.error("[UploadPage] Temporary data (scan result and/or images) was not saved correctly, aborting navigation to edit page.");
                clearTemporaryScanData(uniqueScanId, user.id);
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
   }
};


 const formatDate = (dateString: string | Date | undefined) => {
   if (!dateString) return t('invoices_na');
   try {
      const dateObj = typeof dateString === 'string' ? parseISO(dateString) : dateString;
      if (isNaN(dateObj.getTime())) return t('invoices_invalid_date');
      return window.innerWidth < 640
           ? format(dateObj, 'dd/MM/yy')
           : dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
   } catch (e) {
     console.error("Error formatting date:", e, "Input:", dateString);
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
              {t(`invoice_status_${status}` as any) || status.charAt(0).toUpperCase() + status.slice(1)}
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

  // Helper function defined within the component or file scope
  const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    tFunc: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean }
  ): string => {
      const { decimals = 2, useGrouping = true } = options || {};

      if (value === null || value === undefined || isNaN(value)) {
          const zeroFormatted = (0).toLocaleString(undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: useGrouping,
          });
          return `${tFunc('currency_symbol')}${zeroFormatted}`;
      }

      const formattedValue = value.toLocaleString(undefined, {
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
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="deliveryNote">{t('upload_doc_type_delivery_note')}</TabsTrigger>
              <TabsTrigger value="invoice">{t('upload_doc_type_invoice')}</TabsTrigger>
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

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Input
              type="file"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              accept=".jpg,.jpeg,.png,.pdf"
              aria-label={t('upload_file_input_aria')}
              disabled={isUploading || isProcessing}
            />
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading || isProcessing}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-base py-2.5 px-6"
            >
              {isProcessing ? (
                 <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_processing')}</>
              ) : isUploading ? (
                 <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_uploading')}</>
              ) : (
                <>{t('upload_button_upload_process')}</>
              )}
            </Button>
          </div>
          {(isUploading || isProcessing) && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="w-full h-2.5" aria-label={t('upload_progress_aria', {progress: uploadProgress})}/>
              <p className="text-sm text-muted-foreground text-center">
                 {isProcessing ? t('upload_processing_text') : t('upload_progress_text', {fileName: selectedFile?.name || 'file'})}
              </p>
              {isProcessing && streamingContent && (
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
                            {item.fileName}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell px-2 sm:px-4 py-2">{formatDate(item.uploadTime)}</TableCell>
                        <TableCell className="px-2 sm:px-4 py-2">{renderStatusBadge(item.status)}</TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                          <Button variant="ghost" size="icon" onClick={() => handleViewDetails(item)} className="h-8 w-8" title={t('upload_history_view_details_title', {fileName: item.fileName})} aria-label={t('upload_history_view_details_aria', {fileName: item.fileName})}>
                            <Info className="h-4 w-4 text-primary" />
                          </Button>
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
                      <p><strong>{t('invoice_details_supplier_label')}:</strong> {selectedInvoiceDetails.supplier || t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? formatDisplayNumberWithTranslation(selectedInvoiceDetails.totalAmount, t, { useGrouping: true }) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_invoice_date_label')}:</strong> {selectedInvoiceDetails.invoiceDate ? formatDate(selectedInvoiceDetails.invoiceDate as string) : t('invoices_na')}</p>
                      <p><strong>{t('invoice_details_payment_method_label')}:</strong> {selectedInvoiceDetails.paymentMethod || t('invoices_na')}</p>
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
                  {isValidImageSrc(selectedInvoiceDetails.originalImagePreviewUri) ? (
                    <NextImage
                        src={selectedInvoiceDetails.originalImagePreviewUri}
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