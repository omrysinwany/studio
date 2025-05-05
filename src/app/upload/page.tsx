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
import { useAuth } from '@/context/AuthContext';
import { UploadCloud, FileText, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

// Define the structure for upload history items
interface UploadHistoryItem {
  id: string;
  fileName: string;
  uploadTime: Date;
  status: 'pending' | 'processing' | 'completed' | 'error';
  extractedData?: any; // Store extracted data for potential reprocessing or viewing
  errorMessage?: string;
}

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth(); // Get user context

  // Load history from local storage on mount
   useEffect(() => {
     if (!authLoading && user) { // Only load if user is logged in
       const savedHistory = localStorage.getItem(`uploadHistory_${user.id}`);
       if (savedHistory) {
         try {
           const parsedHistory = JSON.parse(savedHistory).map((item: any) => ({
             ...item,
             uploadTime: new Date(item.uploadTime), // Ensure date is parsed correctly
           }));
           setUploadHistory(parsedHistory);
         } catch (error) {
           console.error("Failed to parse upload history:", error);
           localStorage.removeItem(`uploadHistory_${user.id}`);
         }
       }
     } else if (!authLoading && !user) {
       // Clear history if user logs out
       setUploadHistory([]);
     }
   }, [authLoading, user]);


  // Save history to local storage whenever it changes
   useEffect(() => {
     if (user) {
        localStorage.setItem(`uploadHistory_${user.id}`, JSON.stringify(uploadHistory));
     }
   }, [uploadHistory, user]);


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

  // Function to update the status of a specific history item
   const updateHistoryItemStatus = useCallback((id: string, status: UploadHistoryItem['status'], data?: any, errorMessage?: string) => {
      setUploadHistory(prev => prev.map(item =>
          item.id === id ? { ...item, status, extractedData: data ?? item.extractedData, errorMessage } : item
      ));
   }, []);


 const handleUpload = async () => {
    if (!selectedFile || !user) return;

    setIsUploading(true);
    setIsProcessing(false); // Ensure processing is false initially
    setUploadProgress(0);

    const historyItemId = `${Date.now()}-${selectedFile.name}`; // Unique ID for history
    const newHistoryItem: UploadHistoryItem = {
      id: historyItemId,
      fileName: selectedFile.name,
      uploadTime: new Date(),
      status: 'pending',
    };
    setUploadHistory(prev => [newHistoryItem, ...prev].slice(0, 10)); // Add to history (limit to 10)

    // Simulate upload progress (replace with actual progress if backend supports it)
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        const nextProgress = prev + 10;
        if (nextProgress >= 95) { // Stop just before 100% to indicate processing start
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

         // Update status to processing before calling AI
         updateHistoryItemStatus(historyItemId, 'processing');
         setUploadProgress(100); // Mark upload as complete
         setIsUploading(false);
         setIsProcessing(true); // Indicate processing has started

         try {
             const result = await scanInvoice({ invoiceDataUri: base64data });
             console.log('AI Scan Result:', result);

             // Update history with completed status and data
             updateHistoryItemStatus(historyItemId, 'completed', result);

             toast({
               title: 'Processing Complete',
               description: `${selectedFile.name} processed successfully.`,
             });

              // Navigate to edit page with the extracted data
              // Pass data via query params (or state management)
              router.push(`/edit-invoice?data=${encodeURIComponent(JSON.stringify(result))}&fileName=${encodeURIComponent(selectedFile.name)}`);


         } catch (aiError) {
             console.error('AI processing failed:', aiError);
             updateHistoryItemStatus(historyItemId, 'error', undefined, 'AI failed to process the document.');
              toast({
                title: 'Processing Failed',
                description: 'The AI could not process the document. Please try again or check the file.',
                variant: 'destructive',
              });
          } finally {
             setIsProcessing(false); // Processing finished (success or error)
             setSelectedFile(null); // Clear selection after processing attempt
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
          }
      };

       reader.onerror = (error) => {
         console.error('Error reading file:', error);
         clearInterval(progressInterval); // Clear interval on read error
         setIsUploading(false);
         updateHistoryItemStatus(historyItemId, 'error', undefined, 'Failed to read the file.');
         toast({
           title: 'Upload Failed',
           description: 'Could not read the selected file.',
           variant: 'destructive',
         });
       };

    } catch (error) {
       console.error('Upload failed:', error);
       clearInterval(progressInterval); // Clear interval on unexpected error
       setIsUploading(false);
       updateHistoryItemStatus(historyItemId, 'error', undefined, 'An unexpected error occurred during upload.');
       toast({
         title: 'Upload Failed',
         description: 'An unexpected error occurred. Please try again.',
         variant: 'destructive',
       });
     }
  };

   // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
       toast({
         title: "Authentication Required",
         description: "Please log in to upload documents.",
         variant: "destructive",
       });
    }
  }, [authLoading, user, router, toast]);


  // Render loading state or placeholder if auth is loading or no user
  if (authLoading || !user) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
  }


  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
      <Card className="shadow-md">
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
            />
             <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading || isProcessing}
                className="w-full sm:w-auto bg-accent hover:bg-accent/90"
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
               <Progress value={uploadProgress} className="w-full h-2" />
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

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
             <FileText className="mr-2 h-5 w-5" /> Upload History
          </CardTitle>
          <CardDescription>Status of your recent document uploads.</CardDescription>
        </CardHeader>
        <CardContent>
          {uploadHistory.length === 0 ? (
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
                       {item.uploadTime.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        item.status === 'completed' ? 'bg-green-100 text-green-800' :
                        item.status === 'processing' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                        item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        item.status === 'error' ? 'bg-red-100 text-red-800' : ''
                      }`}>
                        {item.status === 'completed' && <CheckCircle className="mr-1 h-3 w-3" />}
                        {item.status === 'processing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                         {item.status === 'pending' && <Clock className="mr-1 h-3 w-3" />}
                        {item.status === 'error' && <XCircle className="mr-1 h-3 w-3" />}
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                       {item.status === 'error' && item.errorMessage && (
                          <p className="text-xs text-red-600 mt-1 text-right">{item.errorMessage}</p>
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