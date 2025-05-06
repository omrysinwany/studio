
'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { scanInvoice } from '@/ai/flows/scan-invoice'; // Import the AI flow
import { useRouter } from 'next/navigation'; // Use App Router's useRouter
import { UploadCloud, FileText, Clock, CheckCircle, XCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { InvoiceHistoryItem, getInvoices, saveProducts } from '@/services/backend'; // Import getInvoices and saveProducts
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import NextImage from 'next/image';


const TEMP_DATA_KEY_PREFIX = 'invoTrackTempData_';

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<InvoiceHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true); // State for loading history
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  const [showImageModal, setShowImageModal] = useState(false);
  const [currentImageUri, setCurrentImageUri] = useState<string | undefined>(undefined);

  // Function to fetch upload history
  const fetchHistory = useCallback(async () => {
     setIsLoadingHistory(true);
     try {
        const history = await getInvoices(); // Use backend service function
        // Sort by date descending
        const sortedHistory = history.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());
        setUploadHistory(sortedHistory.slice(0, 10)); // Keep only the latest 10
     } catch (error) {
       console.error("Failed to load upload history:", error);
       toast({
         title: "History Load Failed",
         description: "Could not load recent uploads.",
         variant: "destructive",
       });
       setUploadHistory([]); // Clear history on error
     } finally {
       setIsLoadingHistory(false);
     }
  }, [toast]);

  // Load history on mount
   useEffect(() => {
     fetchHistory();
   }, [fetchHistory]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Basic validation (can be expanded)
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select a JPEG, PNG, or PDF file.',
          variant: 'destructive',
        });
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = ''; // Reset file input
        }
        return;
      }
      setSelectedFile(file);
      setUploadProgress(0); // Reset progress when a new file is selected
      setIsProcessing(false); // Reset processing state
    }
  };


 const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setIsProcessing(false);
    setUploadProgress(0);

    // Optimistic UI: Add a temporary item to history
    const tempId = `temp-${Date.now()}-${selectedFile.name}`;
    const optimisticItem: InvoiceHistoryItem = {
      id: tempId,
      fileName: selectedFile.name,
      uploadTime: new Date(),
      status: 'pending',
      invoiceDataUri: undefined, // No URI initially
    };
    setUploadHistory(prev => [optimisticItem, ...prev.filter(item => item.id !== tempId)].slice(0, 10));


    // Simulate upload progress
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

         // Update optimistic item to 'processing'
         setUploadHistory(prev => prev.map(item => item.id === tempId ? { ...item, status: 'processing' } : item));
         setUploadProgress(100);
         setIsUploading(false);
         setIsProcessing(true);

         try {
             const scanResult = await scanInvoice({ invoiceDataUri: base64data });
             console.log('AI Scan Result:', scanResult);

             // Now call saveProducts with all necessary data including the base64 image URI
             // saveProducts will create the actual InvoiceHistoryItem with status 'completed' or 'error'
             await saveProducts(scanResult.products, selectedFile.name, 'upload', base64data, tempId);

             // Store result in localStorage for editing page (if needed for temporary pass-through)
             const dataKey = `${TEMP_DATA_KEY_PREFIX}${Date.now()}`;
             localStorage.setItem(dataKey, JSON.stringify(scanResult));

             toast({
               title: 'Processing & Save Complete',
               description: `${selectedFile.name} processed. Review in edit page or inventory/invoices.`,
             });
             router.push(`/edit-invoice?key=${dataKey}&fileName=${encodeURIComponent(selectedFile.name)}`);

         } catch (aiOrSaveError) {
             console.error('AI processing or saveProducts failed:', aiOrSaveError);
             // If saveProducts failed, it should have updated the history item's status to 'error'
             // If scanInvoice failed before saveProducts was called, update optimistic item
             setUploadHistory(prev => prev.map(item =>
                item.id === tempId ? { ...item, status: 'error', errorMessage: (aiOrSaveError as Error).message || 'Processing/Save failed' } : item
             ));
              toast({
                title: 'Processing Failed',
                description: (aiOrSaveError as Error).message || 'Could not process or save the document.',
                variant: 'destructive',
              });
          } finally {
             setIsProcessing(false);
             setSelectedFile(null);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
              await fetchHistory(); // Refresh history to get the final status from backend
          }
      };

       reader.onerror = async (error) => {
         console.error('Error reading file:', error);
         clearInterval(progressInterval);
         setIsUploading(false);
         setUploadHistory(prev => prev.map(item =>
            item.id === tempId ? { ...item, status: 'error', errorMessage: 'Failed to read file' } : item
         ));
         toast({
           title: 'Upload Failed',
           description: 'Could not read the selected file.',
           variant: 'destructive',
         });
         await fetchHistory();
       };

    } catch (error) {
       console.error('Upload failed:', error);
       clearInterval(progressInterval);
       setIsUploading(false);
       setUploadHistory(prev => prev.map(item =>
          item.id === tempId ? { ...item, status: 'error', errorMessage: 'Unexpected upload error' } : item
       ));
       toast({
         title: 'Upload Failed',
         description: 'An unexpected error occurred. Please try again.',
         variant: 'destructive',
       });
       await fetchHistory();
     }
  };


  // Format date for display
   const formatDate = (date: Date | string | undefined) => {
     if (!date) return 'N/A';
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return dateObj.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
     } catch (e) {
       return 'Invalid Date';
     }
   };

   const handleViewImage = (imageUri: string | undefined) => {
    if (imageUri) {
      setCurrentImageUri(imageUri);
      setShowImageModal(true);
    } else {
      toast({
        title: "No Image",
        description: "No image is available for this invoice.",
        variant: "default",
      });
    }
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
                            {item.invoiceDataUri ? (
                              <Button
                                variant="link"
                                className="p-0 h-auto text-left font-medium cursor-pointer hover:underline"
                                onClick={() => handleViewImage(item.invoiceDataUri)}
                                title={`View image for ${item.fileName}`}
                              >
                                {item.fileName}
                              </Button>
                            ) : (
                              item.fileName
                            )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground px-2 sm:px-4 py-2">
                        {formatDate(item.uploadTime)}
                        </TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                            item.status === 'processing' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse' :
                            item.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                            item.status === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                        }`}>
                            {item.status === 'completed' && <CheckCircle className="mr-1 h-3 w-3" />}
                            {item.status === 'processing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            {item.status === 'pending' && <Clock className="mr-1 h-3 w-3" />}
                            {item.status === 'error' && <XCircle className="mr-1 h-3 w-3" />}
                            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </span>
                        {item.status === 'error' && item.errorMessage && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 text-right" title={item.errorMessage}>{item.errorMessage}</p>
                        )}
                        </TableCell>
                        <TableCell className="text-right px-2 sm:px-4 py-2">
                            {item.invoiceDataUri && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-primary hover:text-primary/80 h-7 w-7"
                                onClick={() => handleViewImage(item.invoiceDataUri)}
                                title={`View image for ${item.fileName}`}
                                aria-label={`View image for ${item.fileName}`}
                              >
                                <ImageIcon className="h-4 w-4" />
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

      <Dialog open={showImageModal} onOpenChange={setShowImageModal}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Invoice Image</DialogTitle>
            <DialogDescription>Viewing scanned document.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-auto max-h-[70vh]">
            {currentImageUri && (
              <NextImage
                src={currentImageUri}
                alt="Scanned Invoice"
                width={800}
                height={1100}
                className="rounded-md object-contain"
                data-ai-hint="invoice document"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
