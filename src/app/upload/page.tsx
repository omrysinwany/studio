
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
import { UploadCloud, FileText, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { InvoiceHistoryItem, getInvoices } from '@/services/backend'; // Import getInvoices for history


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

  // Function to update the status of a specific history item (used visually during upload/processing)
   const updateVisualStatus = useCallback((id: string, status: InvoiceHistoryItem['status'], errorMessage?: string) => {
      setUploadHistory(prev => prev.map(item =>
          item.id === id ? { ...item, status, errorMessage } : item
      ));
   }, []);


 const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setIsProcessing(false); // Ensure processing is false initially
    setUploadProgress(0);

    const tempId = `temp-${Date.now()}-${selectedFile.name}`; // Temporary ID for visual feedback
    const optimisticItem: InvoiceHistoryItem = {
      id: tempId,
      fileName: selectedFile.name,
      uploadTime: new Date(), // Use Date object locally
      status: 'pending',
    };
    // Add optimistic item to the top
    setUploadHistory(prev => [optimisticItem, ...prev].slice(0, 10));

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
      // Convert file to data URI for the AI flow
      const reader = new FileReader();
      reader.readAsDataURL(selectedFile);
      reader.onloadend = async () => {
         const base64data = reader.result as string;

         // Update visual status to processing
         updateVisualStatus(tempId, 'processing');
         setUploadProgress(100); // Mark upload as complete visually
         setIsUploading(false);
         setIsProcessing(true); // Indicate processing has started visually

         try {
             const result = await scanInvoice({ invoiceDataUri: base64data });
             console.log('AI Scan Result:', result);

             // Update visual status to completed (backend save will handle permanent record)
             updateVisualStatus(tempId, 'completed');

             toast({
               title: 'Processing Complete',
               description: `${selectedFile.name} processed. Please review and save.`,
             });

             // Store result in localStorage and navigate with a key
             const dataKey = `${TEMP_DATA_KEY_PREFIX}${Date.now()}`;
             try {
                localStorage.setItem(dataKey, JSON.stringify(result));
                 // Navigate to edit page with the key and filename
                 router.push(`/edit-invoice?key=${dataKey}&fileName=${encodeURIComponent(selectedFile.name)}`);
             } catch (storageError) {
                 console.error("Failed to save scan results to localStorage:", storageError);
                 updateVisualStatus(tempId, 'error', 'Failed to prepare data for editing.');
                 toast({
                     title: 'Error Preparing Data',
                     description: 'Could not store scan results for editing. Please try again.',
                     variant: 'destructive',
                 });
                 // Fallback: Attempt to navigate with data in URL, though it might fail again
                 // router.push(`/edit-invoice?data=${encodeURIComponent(JSON.stringify(result))}&fileName=${encodeURIComponent(selectedFile.name)}`);
                 await fetchHistory(); // Refresh history
             }

         } catch (aiError) {
             console.error('AI processing failed:', aiError);
             // Update visual status to error
             updateVisualStatus(tempId, 'error', 'AI failed to process the document.');
              toast({
                title: 'Processing Failed',
                description: 'The AI could not process the document. Please try again or check the file.',
                variant: 'destructive',
              });
              await fetchHistory(); // Refresh history to show the error from backend if it exists
          } finally {
             setIsProcessing(false); // Processing finished (success or error) visually
             setSelectedFile(null); // Clear selection after processing attempt
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
          }
      };

       reader.onerror = async (error) => {
         console.error('Error reading file:', error);
         clearInterval(progressInterval); // Clear interval on read error
         setIsUploading(false);
         // Update visual status to error
         updateVisualStatus(tempId, 'error', 'Failed to read the file.');
         toast({
           title: 'Upload Failed',
           description: 'Could not read the selected file.',
           variant: 'destructive',
         });
         await fetchHistory(); // Refresh history
       };

    } catch (error) {
       console.error('Upload failed:', error);
       clearInterval(progressInterval); // Clear interval on unexpected error
       setIsUploading(false);
        // Update visual status to error
       updateVisualStatus(tempId, 'error', 'An unexpected error occurred during upload.');
       toast({
         title: 'Upload Failed',
         description: 'An unexpected error occurred. Please try again.',
         variant: 'destructive',
       });
       await fetchHistory(); // Refresh history
     }
  };


  // Format date for display
   const formatDate = (date: Date | string | undefined) => {
     if (!date) return 'N/A';
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return dateObj.toLocaleString(); // Date and time
     } catch (e) {
       return 'Invalid Date';
     }
   };


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
      <Card className="shadow-md bg-card text-card-foreground">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
             <UploadCloud className="mr-2 h-6 w-6" /> Upload New Document
          </CardTitle>
          <CardDescription>Select a JPEG, PNG, or PDF file of your invoice or delivery note.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Input
              id="document"
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".jpg,.jpeg,.png,.pdf"
              className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
              aria-label="Select document file"
            />
             <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading || isProcessing}
                className="w-full sm:w-auto bg-accent hover:bg-accent/90 text-accent-foreground"
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
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
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
            <p className="text-center text-muted-foreground">No recent uploads.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Upload Time</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploadHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium truncate max-w-xs">{item.fileName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                       {formatDate(item.uploadTime)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        item.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                        item.status === 'processing' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse' :
                        item.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                        item.status === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' // Fallback style
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
