
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
import { InvoiceHistoryItem, getInvoicesService, finalizeSaveProductsService } from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const TEMP_DATA_KEY_PREFIX = 'invoTrackTempScan_';
const TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX = 'invoTrackTempOriginalImagePreviewUri_';
const TEMP_COMPRESSED_IMAGE_KEY_PREFIX = 'invoTrackTempCompressedImageUri_';
const INVOICES_STORAGE_KEY = 'mockInvoicesData';

// Max size for storing the ORIGINAL image preview URI in localStorage (e.g., for edit page preview)
const MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES = 0.5 * 1024 * 1024; // 0.5MB
// Max size for storing the COMPRESSED image URI (meant for final save) in localStorage
const MAX_COMPRESSED_IMAGE_STORAGE_BYTES = 0.25 * 1024 * 1024; // 0.25MB
const MAX_SCAN_RESULTS_SIZE_BYTES = 2 * 1024 * 1024; // 2MB for scan results JSON

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadHistory, setUploadHistory] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);

  const fetchHistory = useCallback(async () => {
     setIsLoadingHistory(true);
     try {
        const history = await getInvoicesService();
        const sortedHistory = history.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
        setUploadHistory(sortedHistory.slice(0, 10));
     } catch (error) {
       console.error("Failed to load upload history:", error);
       toast({
         title: "History Load Failed",
         description: "Could not load recent uploads.",
         variant: "destructive",
       });
       setUploadHistory([]);
     } finally {
       setIsLoadingHistory(false);
     }
  }, [toast]);

   useEffect(() => {
     fetchHistory();
   }, [fetchHistory]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select a JPEG, PNG, or PDF file.',
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


   try {
      const reader = new FileReader();
      reader.readAsDataURL(selectedFile);

      reader.onloadend = async () => {
         const originalBase64Data = reader.result as string;

         setUploadProgress(100);
         setIsUploading(false);
         setIsProcessing(true);

         const timestamp = Date.now();
         const uniqueScanId = `${timestamp}_${selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
         const dataKey = `${TEMP_DATA_KEY_PREFIX}${uniqueScanId}`;
         const originalImagePreviewKey = `${TEMP_ORIGINAL_IMAGE_PREVIEW_KEY_PREFIX}${uniqueScanId}`;
         const compressedImageKey = `${TEMP_COMPRESSED_IMAGE_KEY_PREFIX}${uniqueScanId}`;
         const tempInvoiceId = `pending-inv-${uniqueScanId}`;

         let scanResult: ScanInvoiceOutput = { products: [] };
         let scanDataSavedForEdit = false; // Tracks if data for edit page (scan results + optional preview image) is saved
         let compressedImageForFinalSaveUriSaved = false; // Tracks if compressed image for final save is stored in LS

         let imageToScan = originalBase64Data;
         let imageToStoreForFinalSave: string | undefined = undefined;
         let imageForPreviewOnEditPage: string | undefined = undefined;

         // Create PENDING invoice record without image initially
         try {
             const pendingInvoice: InvoiceHistoryItem = {
                 id: tempInvoiceId,
                 fileName: selectedFile.name,
                 uploadTime: new Date().toISOString(),
                 status: 'pending',
                 invoiceDataUri: undefined, // Will be updated after successful save if image is stored
             };
            let currentInvoices: InvoiceHistoryItem[] = JSON.parse(localStorage.getItem(INVOICES_STORAGE_KEY) || '[]');
            currentInvoices = [pendingInvoice, ...currentInvoices];
            localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(currentInvoices));
            console.log(`[UploadPage] Created PENDING invoice record ID: ${tempInvoiceId}`);
         } catch (e: any) {
            console.error("[UploadPage] Failed to create PENDING invoice record in localStorage:", e);
             if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.message.includes('exceeded the quota'))) {
                 toast({
                    title: 'Storage Full for Invoice History',
                    description: `Could not save pending invoice record. LocalStorage quota exceeded. File: ${selectedFile.name}`,
                    variant: 'destructive',
                    duration: 7000,
                });
            }
         }

        // Image processing (compression)
        try {
            imageToStoreForFinalSave = await compressImage(originalBase64Data);
            console.log(`[UploadPage] Image compressed. Original size: ${(originalBase64Data.length / 1024).toFixed(2)}KB, Compressed size: ${(imageToStoreForFinalSave.length / 1024).toFixed(2)}KB`);

            // Store compressed image for final save if small enough
            if (imageToStoreForFinalSave.length <= MAX_COMPRESSED_IMAGE_STORAGE_BYTES) {
                try {
                   localStorage.setItem(compressedImageKey, imageToStoreForFinalSave);
                   compressedImageForFinalSaveUriSaved = true;
                   console.log(`[UploadPage] Compressed image URI for final save stored with key: ${compressedImageKey}`);
                } catch (storageError: any) {
                   console.warn(`[UploadPage] Failed to store compressed image URI for final save (key: ${compressedImageKey}):`, storageError, ". Will pass data directly if needed.");
                   // Image will be passed directly to finalizeSaveProductsService if this fails
                }
            } else {
                console.warn(`[UploadPage] Compressed image for final save is too large for localStorage (${(imageToStoreForFinalSave.length / (1024*1024)).toFixed(2)}MB). Will pass data directly if needed.`);
            }

            // Decide which image to use for preview on edit page
            // Prioritize original if small enough, then compressed if small enough
            if (originalBase64Data.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                imageForPreviewOnEditPage = originalBase64Data;
            } else if (imageToStoreForFinalSave && imageToStoreForFinalSave.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                imageForPreviewOnEditPage = imageToStoreForFinalSave;
                console.log("[UploadPage] Using compressed image for edit page preview as original is too large.");
            } else {
                console.warn("[UploadPage] Both original and compressed images are too large for edit page preview storage. Preview might be unavailable or low-res.");
            }

            if (imageForPreviewOnEditPage) {
                try {
                    localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                    console.log(`[UploadPage] Image for preview on edit page saved with key: ${originalImagePreviewKey}`);
                    // scanDataSavedForEdit will be true if scanResult also saves.
                } catch (storageError: any) {
                    console.warn(`[UploadPage] Failed to store image for edit page preview (key: ${originalImagePreviewKey}):`, storageError);
                    // Preview might not be available on edit page.
                }
            }

        } catch (compressionError) {
            console.error("[UploadPage] Image compression failed:", compressionError, ". Proceeding with original image for scan.");
            imageToScan = originalBase64Data; // Use original for scan
            imageToStoreForFinalSave = originalBase64Data; // Fallback for final save if it's small enough or passed directly

            // Attempt to store original for final save if it's small enough
            if (originalBase64Data.length <= MAX_COMPRESSED_IMAGE_STORAGE_BYTES) {
                 try {
                    localStorage.setItem(compressedImageKey, originalBase64Data);
                    compressedImageForFinalSaveUriSaved = true;
                    console.log(`[UploadPage] Stored original image (fallback) for final save with key: ${compressedImageKey}`);
                 } catch (storageError:any) {
                    console.warn(`[UploadPage] Failed to store original image (fallback) URI for final save (key: ${compressedImageKey}):`, storageError);
                 }
            } else {
                 console.warn(`[UploadPage] Original image (fallback for final save) is too large for localStorage. Will pass data directly if needed.`);
            }

            // Attempt to store original for preview on edit page
            if (originalBase64Data.length <= MAX_ORIGINAL_IMAGE_PREVIEW_STORAGE_BYTES) {
                imageForPreviewOnEditPage = originalBase64Data;
                 try {
                    localStorage.setItem(originalImagePreviewKey, imageForPreviewOnEditPage);
                 } catch (storageError:any) {
                    console.warn(`[UploadPage] Failed to store original image for edit page preview (key: ${originalImagePreviewKey}):`, storageError);
                 }
            } else {
                console.warn("[UploadPage] Original image is too large for edit page preview storage even after compression failure.");
            }
        }


         try {
             console.log(`[UploadPage] Calling scanInvoice for file: ${selectedFile.name}`);
             scanResult = await scanInvoice({ invoiceDataUri: imageToScan });
             console.log('[UploadPage] AI Scan Result:', scanResult);

            if (scanResult.error) {
                toast({
                    title: 'Scan Error',
                    description: `Could not extract products: ${scanResult.error}`,
                    variant: 'destructive',
                    duration: 7000,
                });
            }

            try {
                const scanResultString = JSON.stringify(scanResult);
                if (scanResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                    throw new Error(`Scan results data is too large for localStorage (${(scanResultString.length / (1024*1024)).toFixed(2)}MB).`);
                }
                localStorage.setItem(dataKey, scanResultString);
                scanDataSavedForEdit = true; // Scan results are now saved
                console.log(`[UploadPage] Scan results (products/error) saved to localStorage with key: ${dataKey}`);
            } catch (storageError: any) {
                 console.error(`[UploadPage] Error saving scan results to localStorage for key ${dataKey}:`, storageError);
                 toast({
                     title: 'Critical Error: Cannot Save Scan Data',
                     description: `Could not save processed scan results or image. LocalStorage might be full or unresponsive. Please try clearing some space or reducing file size and try again.`,
                     variant: 'destructive',
                     duration: 10000,
                 });
                 setIsProcessing(false);
                 setSelectedFile(null);
                 if (fileInputRef.current) fileInputRef.current.value = '';
                 localStorage.removeItem(dataKey);
                 localStorage.removeItem(originalImagePreviewKey); // Attempt to clear image key if it was set
                 localStorage.removeItem(compressedImageKey); // Attempt to clear compressed image key
                 fetchHistory();
                 return;
            }

             if (!scanResult.error && scanDataSavedForEdit) {
                 toast({
                   title: 'Scan Complete',
                   description: `${selectedFile.name} scanned. Review and save on the next page.`,
                 });
             }

         } catch (aiError: any) {
             console.error('[UploadPage] AI processing failed:', aiError);
             const errorMessage = `AI Processing Error: ${(aiError as Error).message || 'Unknown AI error'}`;
             toast({ title: 'Processing Error', description: errorMessage, variant: 'destructive', duration: 8000 });
             scanResult = { ...scanResult, error: errorMessage }; // Preserve any products already found, add error

            try {
                const errorResultString = JSON.stringify(scanResult);
                if (errorResultString.length > MAX_SCAN_RESULTS_SIZE_BYTES) {
                    throw new Error("Error scan results data is too large for localStorage.");
                }
                localStorage.setItem(dataKey, errorResultString);
                scanDataSavedForEdit = true; // Error scan results are also considered "saved" for edit
            } catch (storageError: any) {
                console.error(`[UploadPage] Critical Error: Error saving error scan results to localStorage for key ${dataKey} after AI error:`, storageError);
                toast({
                    title: 'Critical Error',
                    description: 'Could not save scan results after AI processing error. Please try again.',
                    variant: 'destructive',
                    duration: 10000,
                });
                setIsProcessing(false);
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
                localStorage.removeItem(dataKey);
                localStorage.removeItem(originalImagePreviewKey);
                localStorage.removeItem(compressedImageKey);
                fetchHistory();
                return;
            }
          } finally {
             // This ensures UI reset and history refresh happens after everything.
             Promise.resolve().finally(() => {
                 if (scanDataSavedForEdit) { // Only proceed if scan data (even if error) was saved
                     const queryParams = new URLSearchParams({
                         key: dataKey,
                         fileName: selectedFile.name,
                         tempInvoiceId: tempInvoiceId,
                     });
                      // Only add image keys if they were successfully stored
                     if (localStorage.getItem(originalImagePreviewKey)) {
                         queryParams.append('originalImagePreviewKey', originalImagePreviewKey);
                     }
                     if (compressedImageForFinalSaveUriSaved) { // Specifically check if compressed was stored
                         queryParams.append('compressedImageKey', compressedImageKey);
                     }
                     router.push(`/edit-invoice?${queryParams.toString()}`);
                 } else {
                     console.error("[UploadPage] Temporary data (scan result or image) was not saved, aborting navigation to edit page.");
                     localStorage.removeItem(dataKey);
                     localStorage.removeItem(originalImagePreviewKey);
                     localStorage.removeItem(compressedImageKey);
                 }

                 setIsProcessing(false);
                 setSelectedFile(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                  fetchHistory();
             });
          }
      };

       reader.onerror = async (error) => {
         console.error('[UploadPage] Error reading file:', error);
         clearInterval(progressInterval);
         setIsUploading(false);
         toast({
           title: 'Upload Failed',
           description: 'Could not read the selected file.',
           variant: 'destructive',
         });
       };

    } catch (error) {
       console.error('[UploadPage] Upload failed:', error);
       clearInterval(progressInterval);
       setIsUploading(false);
       toast({
         title: 'Upload Failed',
         description: 'An unexpected error occurred. Please try again.',
         variant: 'destructive',
       });
     }
  };


   const formatDate = (date: Date | string | undefined) => {
     if (!date) return 'N/A';
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(dateObj.getTime())) return 'Invalid Date';
        return window.innerWidth < 640
             ? format(dateObj, 'dd/MM/yy')
             : dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
     } catch (e) {
       console.error("Error formatting date:", e, "Input:", date);
       return 'Invalid Date';
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
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
         );
    };

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
             <UploadCloud className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> Upload New Document
          </CardTitle>
          <CardDescription>Select a JPEG, PNG, or PDF file of your invoice or delivery note.</CardDescription>
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
              aria-label="Select document file"
            />
             <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading || isProcessing}
                className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground shrink-0"
              >
               {isUploading ? (
                 <>
                   <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
                 </>
               ) : isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...
                  </>
                ) : (
                 <>
                   <UploadCloud className="mr-2 h-4 w-4" /> Upload & Process
                 </>
               )}
             </Button>
          </div>
           {(isUploading || uploadProgress > 0) && !isProcessing && (
             <div className="space-y-1">
               <p className="text-sm text-muted-foreground">Uploading {selectedFile?.name}...</p>
               <Progress value={uploadProgress} className="w-full h-2" aria-label={`Upload progress ${uploadProgress}%`} />
             </div>
           )}
           {isProcessing && (
             <div className="flex items-center gap-2 text-sm text-accent">
               <Loader2 className="h-4 w-4 animate-spin" />
               <span>Processing document, please wait...</span>
             </div>
           )}
        </CardContent>
      </Card>

      <Card className="shadow-md bg-card text-card-foreground scale-fade-in" style={{animationDelay: '0.1s'}}>
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl font-semibold text-primary flex items-center">
             <FileText className="mr-2 h-5 w-5" /> Upload History (Recent 10)
          </CardTitle>
          <CardDescription>Status of your recent document uploads.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingHistory ? (
             <div className="flex justify-center items-center h-24">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2">Loading history...</span>
             </div>
           ) : uploadHistory.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No recent uploads.</p>
          ) : (
            <div className="overflow-x-auto relative">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead className="w-[40%] sm:w-[50%]">File Name</TableHead>
                    <TableHead>Upload Time</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                                title={`View details for ${item.fileName}`}
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
                                title={`View details for ${item.fileName}`}
                                aria-label={`View details for ${item.fileName}`}
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
            <DialogTitle>Invoice Details</DialogTitle>
            <DialogDescription>
              Detailed information for: {selectedInvoiceDetails?.fileName}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetails && (
             <ScrollArea className="flex-grow p-0"> {/* Adjusted padding */}
              <div className="p-4 sm:p-6 space-y-4"> {/* Content padding */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p><strong>File Name:</strong> {selectedInvoiceDetails.fileName}</p>
                      <p><strong>Upload Time:</strong> {formatDate(selectedInvoiceDetails.uploadTime)}</p>
                       <div className="flex items-center">
                        <strong className="mr-1">Status:</strong> {renderStatusBadge(selectedInvoiceDetails.status)}
                       </div>
                    </div>
                    <div>
                      <p><strong>Invoice Number:</strong> {selectedInvoiceDetails.invoiceNumber || 'N/A'}</p>
                      <p><strong>Supplier:</strong> {selectedInvoiceDetails.supplier || 'N/A'}</p>
                      <p><strong>Total Amount:</strong> {selectedInvoiceDetails.totalAmount !== undefined ? `₪${formatDisplayNumber(selectedInvoiceDetails.totalAmount, { useGrouping: true })}` : 'N/A'}</p>
                    </div>
                  </div>
                  {selectedInvoiceDetails.errorMessage && (
                    <div>
                      <p className="font-semibold text-destructive">Error Message:</p>
                      <p className="text-destructive text-xs">{selectedInvoiceDetails.errorMessage}</p>
                    </div>
                  )}
                  <Separator />
                  <div className="overflow-auto max-h-[50vh]">
                    {selectedInvoiceDetails.invoiceDataUri && selectedInvoiceDetails.invoiceDataUri.trim() !== '' ? (
                      <NextImage
                        src={selectedInvoiceDetails.invoiceDataUri}
                        alt={`Scanned image for ${selectedInvoiceDetails.fileName}`}
                        width={800}
                        height={1100}
                        className="rounded-md object-contain mx-auto"
                        data-ai-hint="invoice document"
                      />
                    ) : (
                      <p className="text-muted-foreground text-center py-4">No image available for this invoice.</p>
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
