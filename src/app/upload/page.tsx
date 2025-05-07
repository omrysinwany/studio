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
import { useRouter } from 'next/navigation'; // Use App Router's useRouter
import { UploadCloud, FileText, Clock, CheckCircle, XCircle, Loader2, Image as ImageIcon, Info } from 'lucide-react'; // Added Info icon
import { InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';
import { Separator } from '@/components/ui/separator'; // Import Separator
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';


const TEMP_DATA_KEY_PREFIX = 'invoTrackTempData_';
const TEMP_IMAGE_URI_KEY_PREFIX = 'invoTrackTempImageUri_';

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


export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedInvoiceDetails, setSelectedInvoiceDetails] = useState<InvoiceHistoryItem | null>(null);

  const fetchHistory = useCallback(async () => {
     setIsLoadingHistory(true);
     try {
        const history = await getInvoicesService(); // Use getInvoicesService
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
         const base64data = reader.result as string;

         setUploadProgress(100);
         setIsUploading(false);
         setIsProcessing(true);
         
         const tempInvoiceId = `temp-inv-${Date.now()}`;
         const dataKey = `${TEMP_DATA_KEY_PREFIX}${Date.now()}_${encodeURIComponent(selectedFile.name)}`;
         const imageUriKey = `${TEMP_IMAGE_URI_KEY_PREFIX}${Date.now()}_${encodeURIComponent(selectedFile.name)}`;
         let imageUriSaved = false;
         let scanResult: ScanInvoiceOutput = { products: [] }; // Default to empty products

         try {
             console.log(`[UploadPage] Calling scanInvoice for file: ${selectedFile.name}`);
             scanResult = await scanInvoice({ invoiceDataUri: base64data });
             console.log('[UploadPage] AI Scan Result:', scanResult);

             try {
                localStorage.setItem(imageUriKey, base64data);
                imageUriSaved = true;
             } catch (storageError: any) {
                if (storageError.name === 'QuotaExceededError' || storageError.message.includes('exceeded the quota')) {
                    console.warn(`[UploadPage] localStorage quota exceeded for image URI for file: ${selectedFile.name}. Proceeding without saving image URI.`);
                    toast({
                        title: 'Image Too Large',
                        description: 'The invoice image is too large to be stored for preview. Processing will continue.',
                        variant: 'default',
                    });
                } else {
                    console.error(`[UploadPage] Error saving image URI to localStorage for file: ${selectedFile.name}`, storageError);
                }
             }
             toast({
               title: 'Scan Complete',
               description: `${selectedFile.name} scanned. Review and save on the next page.`,
             });

         } catch (aiError: any) {
             console.error('[UploadPage] AI processing failed:', aiError);
             toast({
                title: 'Processing Error',
                description: (aiError as Error).message || 'Could not process the document. Please check the image or try again.',
                variant: 'destructive',
             });
             // scanResult will remain { products: [] }
          } finally {
             // Always set localStorage for products, even if AI failed (it will be an empty list)
             localStorage.setItem(dataKey, JSON.stringify(scanResult));
             
             // Navigate to edit page regardless of AI success/failure
             // The edit page will show an empty table if scanResult.products is empty.
             router.push(`/edit-invoice?key=${dataKey}&imageKey=${imageUriSaved ? imageUriKey : ''}&fileName=${encodeURIComponent(selectedFile.name)}&tempId=${tempInvoiceId}`);
            
             setIsProcessing(false);
             setSelectedFile(null);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
              // Fetch history after processing is complete (success or failure)
              // to reflect any invoice record created by saveProducts if applicable,
              // or just to refresh the list.
              // Note: saveProducts is called from edit-invoice, so history will update then.
              // However, if you want to show a 'processing' state in history immediately,
              // you'd create a temporary history item here. For now, relying on edit page's save.
              // await fetchHistory(); 
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
         // await fetchHistory(); // Fetch history on error // No, saveProducts handles this from edit page
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
       // await fetchHistory(); // Fetch history on error // No, saveProducts handles this from edit page
     }
  };


   const formatDate = (date: Date | string | undefined) => {
     if (!date) return 'N/A';
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
     } catch (e) {
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
      <Card className="shadow-md bg-card text-card-foreground">
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

      <Card className="shadow-md bg-card text-card-foreground">
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
                        {item.status === 'error' && item.errorMessage && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 text-right" title={item.errorMessage}>{item.errorMessage}</p>
                        )}
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
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Invoice Details</DialogTitle>
            <DialogDescription>
              Detailed information for: {selectedInvoiceDetails?.fileName}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetails && (
            <div className="mt-4 space-y-4">
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
                {selectedInvoiceDetails.invoiceDataUri ? (
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
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
