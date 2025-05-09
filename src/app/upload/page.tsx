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
import { InvoiceHistoryItem, getInvoicesService, TEMP_DATA_KEY_PREFIX, TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX, TEMP_COMPRESSED_IMAGE_KEY_PREFIX, MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES, MAX_COMPRESSED_IMAGE_STORAGE_BYTES, MAX_SCAN_RESULTS_SIZE_BYTES, clearTemporaryScanData } from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';


const INVOICES_STORAGE_KEY = 'mockInvoicesData';

const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
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

  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);


  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);


  const fetchHistory = useCallback(async () => {
     if (!user) return; // Don't fetch if not authenticated
     setIsLoadingHistory(true);
     try {
        const history = await getInvoicesService();
        const sortedHistory = history.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
        setUploadHistory(sortedHistory.slice(0, 10));
     } catch (error) {
       console.error("Failed to load upload history:", error);
       toast({
         title: t('upload_toast_history_load_fail_title'),
         description: t('upload_toast_history_load_fail_desc'),
         variant: "destructive",
       });
       setUploadHistory([]);
     } finally {
       setIsLoadingHistory(false);
     }
  }, [toast, t, user]);

   useEffect(() => {
     if(user) { // Only fetch if user is authenticated
        fetchHistory();
     }
   }, [fetchHistory, user]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('upload_toast_invalid_file_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }
      setSelectedFile(file);
      setUploadProgress(0);
      setIsProcessing(false);
    }
  };


 const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setIsProcessing(false);
    setUploadProgress(0);

    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        const nextProgress = prev + 10;
        if (nextProgress >= 95) {
          clearInterval(progressInterval);
          return 95;
        }
        return nextProgress;
      });
    }, 200);

    const timestamp = Date.now();
    const originalFileName = selectedFile.name;
    const uniqueScanId = `${timestamp}_${originalFileName.replace(/[^a-zA-Z0-9.]/g, '_')}`;

    const dataKey = `${TEMP_DATA_KEY_PREFIX}${uniqueScanId}`;
    const originalImagePreviewKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${uniqueScanId}`;
    const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${uniqueScanId}`;
    const tempInvoiceId = `pending-inv-${uniqueScanId}`;

    let scanResult: ScanInvoiceOutput = { products: [] };
    let scanDataSavedForEdit = false;
    let originalImagePreviewUriSaved = false;
    let compressedImageForFinalSaveUriSaved = false;
    let originalBase64Data = '';


   try {
      const reader = new FileReader();
      reader.readAsDataURL(selectedFile);

      reader.onloadend = async () => {
         originalBase64Data = reader.result as string;

         setUploadProgress(100);
         setIsUploading(false);
         setIsProcessing(true);

         try {
             const pendingInvoice: InvoiceHistoryItem = {
                 id: tempInvoiceId,
                 fileName: originalFileName,
                 uploadTime: new Date().toISOString(),
                 status: 'pending',
                 invoiceDataUri: undefined, // Will be updated if successfully saved
             };
            let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(INVOICES_STORAGE_KEY) || '[]');
            currentInvoices = [pendingInvoice, ...currentInvoices];
            localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(currentInvoices));
            console.log(`[UploadPage] Created PENDING invoice record ID: ${tempInvoiceId}`);
         } catch (e: any) {
            console.error("[UploadPage] Failed to create PENDING invoice record in localStorage:", e);
             if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.message.includes('exceeded the quota'))) {
                 toast({
                    title: t('upload_toast_storage_full_pending_title'),
                    description: t('upload_toast_storage_full_pending_desc', { fileName: originalFileName }),
                    variant: 'destructive',
                    duration: 7000,
                });
            }
         }

        let imageForScan: string | undefined = undefined;
        let imageForFinalSave: string | undefined = undefined;
        let imageForPreviewOnEditPage: string | undefined = undefined;

        try {
            console.log(`[UploadPage] Original image size: ${(originalBase64Data.length / (1024*1024)).toFixed(2)}MB`);
            // Compress for AI Scan (more aggressive compression)
            imageForScan = await compressImage(originalBase64Data, 0.6, 1000, 1000);
            console.log(`[UploadPage] Compressed image for scan size: ${(imageForScan.length / (1024*1024)).toFixed(2)}MB`);

            // Compress for final invoice record (very aggressive if original is large, less if small)
            const finalSaveQuality = originalBase64Data.length > MAX_COMPRESSED_IMAGE_STORAGE_BYTES * 2 ? 0.4 : 0.6;
            imageForFinalSave = await compressImage(originalBase64Data, finalSaveQuality, 800, 800);
            console.log(`[UploadPage] Compressed image for final save size: ${(imageForFinalSave.length / (1024*1024)).toFixed(2)}MB`);


            // Compress for edit page preview (less aggressive, better quality)
            const previewQuality = originalBase64Data.length > MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES * 1.5 ? 0.7 : 0.8;
            imageForPreviewOnEditPage = await compressImage(originalBase64Data, previewQuality, 1280, 1280);
            console.log(`[UploadPage] Compressed image for edit page preview size: ${(imageForPreviewOnEditPage.length / (1024*1024)).toFixed(2)}MB`);


             if (imageForFinalSave && imageForFinalSave.length <= MAX_COMPRESSED_IMAGE_STORAGE_BYTES) {
                 try {
                    localStorage.setItem(compressedImageKey, imageForFinalSave);
                    compressedImageForFinalSaveUriSaved = true;
                    console.log(`[UploadPage] Image URI for final save stored with key: ${compressedImageKey}`);
                 } catch (storageError: any) {
                    console.warn(`[UploadPage] Failed to store compressed image URI for final save (key: ${compressedImageKey}):`, storageError.message);
                 }
             } else {
                console.warn(`[UploadPage] Compressed image for FINAL SAVE is too large (${(imageForFinalSave?.length || 0 / (1024*1024)).toFixed(2)}MB > ${(MAX_COMPRESSED_IMAGE_STORAGE_BYTES / (1024*1024)).toFixed(2)}MB ) or missing. It will not be stored for the final invoice record.`);
                imageForFinalSave = undefined; // Ensure it's not used if too large
             }


            if (imageForPreviewOnEditPage && imageForPreviewOnEditPage.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                try {
                    localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                    originalImagePreviewUriSaved = true;
                    console.log(`[UploadPage] Image for preview on edit page saved with key: ${originalImagePreviewKey}`);
                } catch (storageError: any) {
                    console.warn(`[UploadPage] Failed to store image for edit page preview (key: ${originalImagePreviewKey}):`, storageError.message);
                    // If storing preview fails due to quota, log but don't halt; preview is optional.
                }
            } else {
                console.warn(`[UploadPage] Compressed image for PREVIEW on edit page is too large (${(imageForPreviewOnEditPage?.length || 0 / (1024*1024)).toFixed(2)}MB > ${(MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES/(1024*1024)).toFixed(2)}MB) or missing. Preview on edit page might be missing or use a lower quality fallback.`);
            }

        } catch (compressionError) {
            console.error("[UploadPage] Image compression failed:", compressionError, ". Using original for scan if possible.");
            imageForScan = originalBase64Data; // Fallback to original for scan
            imageForFinalSave = undefined; // Don't attempt to save original if compression failed
            imageForPreviewOnEditPage = undefined;

            // Fallback: if original image is small enough for preview and no other preview is set
            if (!originalImagePreviewUriSaved && originalBase64Data.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                 try { localStorage.setItem(originalImagePreviewKey, originalBase64Data); originalImagePreviewUriSaved = true; console.log(`[UploadPage] Fallback: Original image stored for preview as it fits.`); }
                 catch (e) { console.warn(`[UploadPage] Fallback: Failed to store original image for preview.`); }
            }
        }


         try {
             console.log(`[UploadPage] Calling scanInvoice for file: ${originalFileName}`);
             scanResult = await scanInvoice({ invoiceDataUri: imageForScan || originalBase64Data });
             console.log('[UploadPage] AI Scan Result:', scanResult);

            if (scanResult.error) {
                toast({
                    title: t('upload_toast_scan_error_title'),
                    description: t('upload_toast_scan_error_desc', { error: scanResult.error }),
                    variant: 'destructive',
                    duration: 7000,
                });
            }

            try {
                const scanResultString = JSON.stringify(scanResult);
                if (scanResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                    const errorMsg = t('upload_toast_scan_results_too_large_error', { size: (scanResultString.length / (1024*1024)).toFixed(2) });
                    console.error(`[UploadPage] ${errorMsg}`);
                    scanResult = { products: [], error: errorMsg }; // Update scanResult to reflect this specific error
                    // Still attempt to save this error state to localStorage if it fits.
                    localStorage.setItem(dataKey, JSON.stringify(scanResult));
                    scanDataSavedForEdit = true; // Mark as saved, even if it's an error state for "too large"
                     toast({ title: t('upload_toast_critical_error_save_scan_title'), description: errorMsg, variant: 'destructive', duration: 10000 });
                } else {
                    localStorage.setItem(dataKey, scanResultString);
                    scanDataSavedForEdit = true;
                    console.log(`[UploadPage] Scan results (products/error) saved to localStorage with key: ${dataKey}`);
                }
            } catch (storageError: any) {
                 console.error(`[UploadPage] Error saving scan results to localStorage for key ${dataKey}:`, storageError);
                 toast({
                     title: t('upload_toast_critical_error_save_scan_title'),
                     description: t('upload_toast_critical_error_save_scan_desc', { message: storageError.message }),
                     variant: 'destructive',
                     duration: 10000,
                 });
                 // Critical failure, cannot proceed to edit page without scan data
                 setIsProcessing(false);
                 setSelectedFile(null);
                 if (fileInputRef.current) fileInputRef.current.value = '';
                 clearTemporaryScanData(uniqueScanId); // Cleanup after critical failure
                 fetchHistory(); // Refresh history to show pending possibly failed
                 return; // Exit early
            }

             if (!scanResult.error && scanDataSavedForEdit) {
                 toast({
                   title: t('upload_toast_scan_complete_title'),
                   description: t('upload_toast_scan_complete_desc', { fileName: originalFileName }),
                 });
             }

         } catch (aiError: any) {
             console.error('[UploadPage] AI processing failed:', aiError);
             const errorMessage = t('upload_toast_ai_processing_error_desc', { message: (aiError as Error).message || t('pos_unknown_error') });
             toast({ title: t('upload_toast_ai_processing_error_title'), description: errorMessage, variant: 'destructive', duration: 8000 });
             scanResult = { ...scanResult, products: [], error: errorMessage }; // Ensure products is empty on AI error

            try {
                const errorResultString = JSON.stringify(scanResult);
                 if (errorResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                     const errorMsg = t('upload_toast_error_scan_results_too_large_error');
                     console.error(`[UploadPage] ${errorMsg}`);
                     scanResult = { products: [], error: errorMsg };
                     localStorage.setItem(dataKey, JSON.stringify(scanResult)); // Save this "too large" error
                 } else {
                    localStorage.setItem(dataKey, errorResultString);
                 }
                scanDataSavedForEdit = true; // Data (even if error) saved
            } catch (storageError: any) {
                console.error(`[UploadPage] Critical Error: Error saving error scan results to localStorage for key ${dataKey} after AI error:`, storageError);
                toast({
                    title: t('upload_toast_critical_error_title'),
                    description: t('upload_toast_critical_error_save_error_scan_desc', { message: storageError.message }),
                    variant: 'destructive',
                    duration: 10000,
                });
                setIsProcessing(false);
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
                clearTemporaryScanData(uniqueScanId); // Cleanup after critical failure
                fetchHistory();
                return; // Exit early
            }
          } finally {
             if (scanDataSavedForEdit) { // Proceed if scan data (or error state) was saved
                 const queryParams = new URLSearchParams({
                     key: dataKey,
                     fileName: encodeURIComponent(originalFileName), // Ensure filename is URL safe
                     tempInvoiceId: tempInvoiceId,
                 });
                  if (originalImagePreviewUriSaved) { // Only add if it was successfully saved
                     queryParams.append('originalImagePreviewKey', originalImagePreviewKey);
                 }
                 if (compressedImageForFinalSaveUriSaved) { // Only add if it was successfully saved
                     queryParams.append('compressedImageKey', compressedImageKey);
                 }
                 router.push(`/edit-invoice?${queryParams.toString()}`);
             } else {
                 // This case should ideally be caught by earlier returns if localStorage.setItem for dataKey fails
                 console.error("[UploadPage] Critical: Scan data was not saved to localStorage. Aborting navigation to edit page.");
                 clearTemporaryScanData(uniqueScanId); // Cleanup
                 toast({
                    title: t('upload_toast_processing_failed_title'),
                    description: t('upload_toast_processing_failed_desc'),
                    variant: "destructive",
                 });
             }
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
         toast({
           title: t('upload_toast_upload_failed_title'),
           description: t('upload_toast_upload_failed_read_desc'),
           variant: 'destructive',
         });
         clearTemporaryScanData(uniqueScanId); // Ensure cleanup
       };

    } catch (error) {
       console.error('[UploadPage] Upload failed:', error);
       clearInterval(progressInterval);
       setIsUploading(false);
       toast({
         title: t('upload_toast_upload_failed_title'),
         description: t('upload_toast_upload_failed_unexpected_desc', { message: (error as Error).message }),
         variant: 'destructive',
       });
       clearTemporaryScanData(uniqueScanId); // Ensure cleanup
     }
  };


   const formatDate = (date: Date | string | undefined) => {
     if (!date) return t('invoices_na');
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
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

  if (!user) {
    // This part will ideally not be reached if redirection works correctly,
    // but it's a good fallback.
    return (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
            <p>{t('settings_login_required')}</p>
        </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
             <UploadCloud className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('upload_title')}
          </CardTitle>
          <CardDescription>{t('upload_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Input
              id="document"
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".jpg,.jpeg,.png,.pdf"
              className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              aria-label={t('upload_file_input_aria')}
            />
             <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading || isProcessing}
                className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground shrink-0"
              >
               {isUploading ? (
                 <>
                   <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_uploading')}
                 </>
               ) : isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('upload_button_processing')}
                  </>
                ) : (
                 <>
                   <UploadCloud className="mr-2 h-4 w-4" /> {t('upload_button_upload_process')}
                 </>
               )}
             </Button>
          </div>
           {(isUploading || uploadProgress > 0) && !isProcessing && (
             <div className="space-y-1">
               <p className="text-sm text-muted-foreground">{t('upload_progress_text', { fileName: selectedFile?.name || '' })}</p>
               <Progress value={uploadProgress} className="w-full h-2" aria-label={t('upload_progress_aria', { progress: uploadProgress })} />
             </div>
           )}
           {isProcessing && (
             <div className="flex items-center gap-2 text-sm text-accent">
               <Loader2 className="h-4 w-4 animate-spin" />
               <span>{t('upload_processing_text')}</span>
             </div>
           )}
        </CardContent>
      </Card>

      <Card className="shadow-md bg-card text-card-foreground scale-fade-in" style={{animationDelay: '0.1s'}}>
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
             <FileText className="mr-2 h-5 w-5" /> {t('upload_history_title')}
          </CardTitle>
          <CardDescription>{t('upload_history_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
             <div className="flex justify-center items-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2">{t('upload_history_loading')}</span>
             </div>
           ) : uploadHistory.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">{t('upload_history_no_uploads')}</p>
          ) : (
            <div className="overflow-x-auto relative">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead className="w-[40%] sm:w-[50%]">{t('upload_history_col_file_name')}</TableHead>
                    <TableHead>{t('upload_history_col_upload_time')}</TableHead>
                    <TableHead className="text-right">{t('upload_history_col_status')}</TableHead>
                    <TableHead className="text-right">{t('upload_history_col_actions')}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {uploadHistory.map((item) => (
                    <TableRow key={item.id}>
                        <TableCell className="font-medium truncate max-w-[120px] sm:max-w-xs px-2 sm:px-4 py-2">
                           <Button
                                variant="link"
                                className="p-0 h-auto text-left font-medium cursor-pointer hover:underline truncate"
                                onClick={() => handleViewDetails(item)}
                                title={t('upload_history_view_details_title', { fileName: item.fileName })}
                              >
                                {item.fileName}
                            </Button>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground px-2 sm:px-4 py-2">
                        {formatDate(item.uploadTime)}
                        </TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                            {renderStatusBadge(item.status)}
                        </TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-primary hover:text-primary/80 h-7 w-7"
                                onClick={() => handleViewDetails(item)}
                                title={t('upload_history_view_details_title', { fileName: item.fileName })}
                                aria-label={t('upload_history_view_details_aria', { fileName: item.fileName })}
                            >
                                <Info className="h-4 w-4" />
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
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
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
                      <p><strong>{t('invoice_details_total_amount_label')}:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? `${t('currency_symbol')}${formatDisplayNumber(selectedInvoiceDetails.totalAmount, { useGrouping: true })}` : t('invoices_na')}</p>
                    </div>
                  </div>
                  {selectedInvoiceDetails.errorMessage && (
                    <div>
                      <p className="font-semibold text-destructive">{t('invoice_details_error_message_label')}:</p>
                      <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                    </div>
                  )}
                  <Separator />
                  <div className="overflow-auto max-h-[50vh]">
                    {selectedInvoiceDetails.originalImagePreviewUri && selectedInvoiceDetails.originalImagePreviewUri.trim() !== '' ? (
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
