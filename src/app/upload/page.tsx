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
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, Clock, CheckCircle, XCircle, Loader2, Image as ImageIcon, Info } from 'lucide-react';
import {
    InvoiceHistoryItem,
    getInvoicesService,
    TEMP_DATA_KEY_PREFIX,
    TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX,
    TEMP_COMPRESSED_IMAGE_KEY_PREFIX,
    MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES,
    MAX_SCAN_RESULTS_SIZE_BYTES,
    clearTemporaryScanData,
    finalizeSaveProductsService,
    INVOICES_STORAGE_KEY_BASE,
    MAX_INVOICE_HISTORY_ITEMS,
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


const isValidImageSrc = (src: string | undefined): src is string => {
  if (!src || typeof src !== 'string') return false;
  return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://');
};

const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
        return `${t('currency_symbol')}${zeroFormatted}`;
    }

    const formattedValue = value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
    return `${t('currency_symbol')}${formattedValue}`;
};

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
            const outputMimeType = (mimeType === 'image/png') ? 'image/png' : 'image/jpeg';
            resolve(canvas.toDataURL(outputMimeType, quality));
        };
        img.onerror = (error) => {
            console.error("Image load error for compression:", error);
            reject(new Error('Failed to load image for compression'));
        };
    });
}

const getStorageKey = (baseKey: string, userId?: string): string => {
  if (!userId) {
    console.warn(`[getStorageKey UploadPage] Attempted to get storage key for base "${baseKey}" without a userId.`);
    return baseKey;
  }
  return `${baseKey}_${userId}`;
};


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


  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const invoices = await getInvoicesService(user.id);
      setUploadHistory(invoices.slice(0, 10)); // Show recent 10
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
        setScanError(null);
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
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

    const originalFileName = selectedFile.name;
    const reader = new FileReader();
    let progressInterval: NodeJS.Timeout;

    const uniqueScanId = `${Date.now()}_${originalFileName}`;
    const tempInvoiceId = `pending-inv-${user.id}_${uniqueScanId}`;

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${user.id}_${uniqueScanId}`;
    const originalImagePreviewKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${user.id}_${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${user.id}_${uniqueScanId}`;

    let scanDataSavedForEdit = false;
    let originalImagePreviewUriSaved = false;
    let compressedImageForFinalSaveUriSaved = false;

    try {
       // Simulate upload progress
       let currentProgress = 0;
       progressInterval = setInterval(() => {
         currentProgress += 10;
         if (currentProgress <= 100) {
           setUploadProgress(currentProgress);
         } else {
           clearInterval(progressInterval);
           setIsUploading(false);
         }
       }, 150);


       reader.readAsDataURL(selectedFile);
       reader.onloadend = async () => {
           clearInterval(progressInterval);
           setIsUploading(false);
           setUploadProgress(100);

           if (typeof reader.result !== 'string') {
             console.error("FileReader did not return a string result.");
             toast({ title: t('upload_toast_upload_failed_title'), description: "Failed to read file data.", variant: 'destructive' });
             setIsProcessing(false);
             return;
           }

           const originalBase64Data = reader.result;
           let imageForAIScan = originalBase64Data;
           let imageForPreviewOnEditPage = originalBase64Data;
           let imageToStoreForFinalSave: string | undefined = undefined;

            // Attempt to compress image for final save
            try {
                imageToStoreForFinalSave = await compressImage(originalBase64Data);
                console.log(`[UploadPage] Image compressed for final save. Original size: ${originalBase64Data.length}, Compressed size: ${imageToStoreForFinalSave.length}`);
                
                // If compressed version is significantly smaller, consider using it for AI too
                if (imageToStoreForFinalSave.length < originalBase64Data.length * 0.8) { 
                    imageForAIScan = imageToStoreForFinalSave;
                    console.log("[UploadPage] Using compressed image for AI scan.");
                }
                // And also for preview if it's small enough
                if (imageToStoreForFinalSave.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    imageForPreviewOnEditPage = imageToStoreForFinalSave;
                    console.log("[UploadPage] Using compressed image for edit page preview as well.");
                }


                if (imageToStoreForFinalSave.length <= MAX_SCAN_RESULTS_SIZE_BYTES) { // Use MAX_SCAN_RESULTS_SIZE_BYTES as a general small image limit
                    try {
                       localStorage.setItem(compressedImageKey, imageToStoreForFinalSave);
                       compressedImageForFinalSaveUriSaved = true;
                       console.log(`[UploadPage] Image URI for final save stored with key: ${compressedImageKey}`);
                    } catch (storageError: any) {
                       console.warn(`[UploadPage] Failed to save compressed image to localStorage (key: ${compressedImageKey}):`, storageError.message);
                        toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(compressed final save)"}), variant: 'destructive', duration: 8000 });
                        // Proceed without it, originalImagePreviewUri might still be used
                    }
                } else {
                    console.warn(`[UploadPage] Compressed image for final save (${imageToStoreForFinalSave.length} bytes) too large for localStorage (limit approx ${MAX_SCAN_RESULTS_SIZE_BYTES} bytes). Will not be stored with invoice record directly.`);
                }

            } catch (compressionError) {
                console.warn("[UploadPage] Image compression failed, will use original for AI and potentially preview:", compressionError);
            }

             // Save image for preview on edit page
            if (imageForPreviewOnEditPage) {
                if (imageForPreviewOnEditPage.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                    try {
                        localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                        originalImagePreviewUriSaved = true;
                        console.log(`[UploadPage] Image for preview on edit page saved with key: ${originalImagePreviewKey}`);
                    } catch (storageError: any) {
                        console.warn(`[UploadPage] Failed to save original image preview to localStorage (key: ${originalImagePreviewKey}):`, storageError.message);
                        toast({ title: t('upload_toast_storage_full_title_critical'), description: t('upload_toast_storage_full_desc_finalize', {context: "(original preview)"}), variant: 'destructive', duration: 8000 });
                        // Continue without it, edit page will show no preview
                    }
                } else {
                     console.warn(`[UploadPage] Image for preview on edit page (${imageForPreviewOnEditPage.length} bytes) too large for localStorage (limit ${MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES} bytes). Not saving preview.`);
                }
            }

           let scanResult: ScanInvoiceOutput = { products: [] };

           try {
               console.log("[UploadPage] Calling AI to scan invoice...");
               const aiResponse = await scanInvoice({ invoiceDataUri: imageForAIScan }, (update) => {
                setStreamingContent(prev => `${prev}\n${update.content}`);
               });
               scanResult = aiResponse;

               if (aiResponse.error) {
                   console.error("[UploadPage] AI processing returned an error:", aiResponse.error);
                   toast({ title: t('upload_toast_scan_error_title'), description: t('upload_toast_scan_error_desc', { error: aiResponse.error }), variant: 'destructive', duration: 8000 });
                   setScanError(aiResponse.error);
                   // Still save the result with error for the edit page
               }
           } catch (aiError: any) {
                console.error('[UploadPage] AI processing failed:', aiError);
                const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error') });
                toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
                scanResult = { products: [], error: errorMessage };
                setScanError(errorMessage);
           }

            // Save scan result (even if it's an error object)
            try {
                const scanResultString = JSON.stringify(scanResult);
                if (scanResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                    const errorMsg = t('upload_toast_scan_results_too_large_error', { size: (scanResultString.length / (1024*1024)).toFixed(2) });
                    scanResult = { products: [], error: errorMsg };
                    localStorage.setItem(dataKey, JSON.stringify(scanResult));
                    scanDataSavedForEdit = true;
                    toast({ title: t('upload_toast_critical_error_save_scan_title'), description: errorMsg, variant: 'destructive', duration: 10000 });
                } else {
                    localStorage.setItem(dataKey, scanResultString);
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
                 setIsProcessing(false); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fetchHistory();
                 return;
            }

           // Add PENDING invoice record to history immediately
           const pendingInvoice: InvoiceHistoryItem = {
               id: tempInvoiceId,
               fileName: originalFileName,
               uploadTime: new Date().toISOString(),
               status: 'pending',
               paymentStatus: 'unpaid',
               originalImagePreviewUri: originalImagePreviewUriSaved ? localStorage.getItem(originalImagePreviewKey) || undefined : undefined,
               // compressedImageForFinalRecordUri will be added by finalizeSaveProductsService if available
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
               fetchHistory(); // Refresh history to show pending item
            } catch (e: any) {
               console.error("[UploadPage] Failed to create PENDING invoice record in localStorage:", e);
                if (e.name === 'QuotaExceededError') {
                    toast({ title: t('upload_toast_storage_full_pending_title'), description: t('upload_toast_storage_full_pending_desc', { fileName: originalFileName }), variant: 'destructive', duration: 10000});
                }
               // Do not stop processing, try to go to edit page with what was saved
            }


           if (!scanResult.error && scanDataSavedForEdit) {
               toast({
                 title: t('upload_toast_scan_complete_title'),
                 description: t('upload_toast_scan_complete_desc', { fileName: originalFileName }),
               });
           }

           // This ensures UI reset and history refresh happens after everything.
           // The actual navigation is handled after this promise chain
            if (scanDataSavedForEdit) { // Only proceed if scan data (even if error) was saved
                const queryParams = new URLSearchParams({
                    key: dataKey, // Key for the scan result (JSON of ScanInvoiceOutput)
                    fileName: originalFileName,
                    tempInvoiceId: tempInvoiceId, // The ID of the PENDING invoice record
                });
                if (originalImagePreviewUriSaved) {
                    queryParams.append('originalImagePreviewKey', originalImagePreviewKey);
                }
                if (compressedImageForFinalSaveUriSaved) {
                    queryParams.append('compressedImageKey', compressedImageKey);
                }
                router.push(`/edit-invoice?${queryParams.toString()}`);
            } else {
                console.error("[UploadPage] Temporary data (scan result) was not saved, aborting navigation to edit page.");
                clearTemporaryScanData(uniqueScanId, user.id);
                toast({
                   title: t('upload_toast_processing_failed_title'),
                   description: t('upload_toast_processing_failed_desc'),
                   variant: "destructive",
                });
                 setIsProcessing(false);
                 setSelectedFile(null);
                 if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                 }
                 fetchHistory();
            }
       };

     reader.onerror = async (error) => {
       console.error('[UploadPage] Error reading file:', error);
       clearInterval(progressInterval);
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
     clearInterval(progressInterval);
     setIsUploading(false);
     setIsProcessing(false);
     toast({
       title: t('upload_toast_upload_failed_title'),
       description: t('upload_toast_upload_failed_unexpected_desc', { message: (error as Error).message }),
       variant: 'destructive',
     });
   }
};


 const formatDate = (date: Date | string | undefined) => {
   if (!date) return t('invoices_na');
   try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      if (isNaN(dateObj.getTime())) return t('invoices_invalid_date');
      return window.innerWidth < 640
           ? format(dateObj, 'dd/MM/yy')
           : dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
   } catch (e) {
     console.error("Error formatting date:", e, "Input:", date);
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
    return null; // Or a message encouraging login / redirect handled by useEffect in RootLayout
  }

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
          {(isUploading || (isProcessing && !isUploading)) && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="w-full h-2.5" aria-label={t('upload_progress_aria', {progress: uploadProgress})}/>
              <p className="text-sm text-muted-foreground text-center">
                 {isUploading ? t('upload_progress_text', {fileName: selectedFile?.name || 'file'}) : t('upload_processing_text')}
              </p>
              {isProcessing && !isUploading && streamingContent && (
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
                    </div>
                  </div>
                  {selectedInvoiceDetails.errorMessage && (
                    <div className="mt-2">
                      <p className="font-semibold text-destructive">{t('invoice_details_error_message_label')}:</p>
                      <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                    </div>
                  )}
                  <Separator className="my-4"/>
                  <div className="overflow-auto max-h-[calc(85vh-320px)] sm:max-h-[calc(90vh-350px)]"> {/* Adjusted max height */}
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
                    <p className="text-muted-foreground text-center py-4">{t('invoice_details_no_image_available')}</p>
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
