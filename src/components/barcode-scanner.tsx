'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, X, Camera, VideoOff } from 'lucide-react'; // Added Camera, VideoOff icons
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface BarcodeScannerProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onBarcodeDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // null: initial, false: denied/error, true: granted
  const [isInitializing, setIsInitializing] = useState(false); // Track initialization state
  const [isScanningActive, setIsScanningActive] = useState(false); // Track if scanning loop is active
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const barcodeDetectorRef = useRef<any>(null); // Ref to hold the detector instance
  const streamRef = useRef<MediaStream | null>(null); // Ref to hold the camera stream
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for the detection interval

  // Initialize BarcodeDetector if supported (only once)
  useEffect(() => {
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore - BarcodeDetector might not be fully typed yet
        barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['ean_13', 'upc_a', 'code_128'] }); // Adjust formats as needed
        console.log("BarcodeDetector initialized");
      } catch (e: any) {
        console.error("Error initializing BarcodeDetector:", e);
        setError(`Barcode Detector initialization failed: ${e.message}. Scanning may not work.`);
      }
    } else {
      console.warn("BarcodeDetector API not supported in this browser.");
      setError("Barcode scanning is not supported by your browser.");
      setHasCameraPermission(false); // Mark as error state if detector not supported
    }

    // Cleanup function (runs when component unmounts)
    return () => {
       stopScanningProcess(); // Stop stream and interval on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only once

  const stopStream = () => {
     if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        console.log("Camera stream stopped");
        streamRef.current = null;
     }
     if (videoRef.current) {
        videoRef.current.srcObject = null; // Release the source object
     }
  };

   const stopDetectionInterval = () => {
       if (detectionIntervalRef.current) {
         console.log("Clearing barcode detection interval");
         clearInterval(detectionIntervalRef.current);
         detectionIntervalRef.current = null;
       }
       setIsScanningActive(false);
   };

  const stopScanningProcess = () => {
      stopDetectionInterval();
      stopStream();
  };

   // Barcode detection logic (called repeatedly by interval)
   const detectBarcode = useCallback(async () => {
     if (!videoRef.current || !barcodeDetectorRef.current || videoRef.current.readyState < videoRef.current.HAVE_METADATA || !hasCameraPermission || !isScanningActive) {
       // console.log("Conditions not met for detection:", { videoReady: videoRef.current?.readyState, detector: !!barcodeDetectorRef.current, permission: hasCameraPermission, active: isScanningActive });
       return; // Wait until video is ready, detector is initialized, permission granted, and scanning is active
     }

     try {
       // @ts-ignore
       const barcodes = await barcodeDetectorRef.current.detect(videoRef.current);
       // console.log("Detection attempt, barcodes found:", barcodes); // Log detection attempts
       if (barcodes.length > 0) {
         const firstBarcode = barcodes[0].rawValue;
         console.log('Barcode detected:', firstBarcode);
         stopScanningProcess(); // Stop scanning after detection
         onBarcodeDetected(firstBarcode); // Call the callback prop (which should close the dialog)
       }
     } catch (e: any) {
       console.error('Error detecting barcode:', e);
       setError(`Error during barcode detection: ${e.message}`);
       stopScanningProcess(); // Stop on error
       // Potentially show a toast or inline error about detection failure?
     }
   }, [onBarcodeDetected, hasCameraPermission, isScanningActive]); // Include dependencies


  // Function to request permission and start the stream/detection
  const startScan = async () => {
    if (isInitializing || isScanningActive) return; // Prevent multiple calls

    setIsInitializing(true);
    setError(null);
    setHasCameraPermission(null);

    // Check for BarcodeDetector support again, just in case
    if (!barcodeDetectorRef.current) {
       setError("Barcode Detector is not available or failed to initialize.");
       setHasCameraPermission(false);
       setIsInitializing(false);
       return;
    }

    try {
      // Request camera permission
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // Prefer rear camera
      setHasCameraPermission(true);
      setError(null); // Clear previous errors

      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        // Wait for video metadata to load before playing and starting detection
        videoRef.current.onloadedmetadata = async () => {
            try {
                await videoRef.current?.play(); // Ensure video plays
                console.log("Camera stream started and playing");
                setIsScanningActive(true); // Activate scanning loop
                // Start detection interval *after* video is playing
                if (!detectionIntervalRef.current) {
                    console.log("Starting barcode detection interval");
                    detectionIntervalRef.current = setInterval(detectBarcode, 500); // Start detection loop
                }
            } catch (playError) {
                 console.error('Error playing video stream:', playError);
                 setError(`Could not start video stream: ${playError.message}`);
                 setHasCameraPermission(false);
                 stopStream(); // Clean up stream if play fails
            } finally {
                 setIsInitializing(false); // Initialization complete (or failed)
            }
        };
         videoRef.current.onerror = (e) => {
             console.error('Video element error:', e);
             setError('An error occurred with the video stream.');
             setHasCameraPermission(false);
             stopStream();
             setIsInitializing(false);
         };

      } else {
         throw new Error("Video element reference is missing.");
      }

    } catch (error: any) {
      console.error('Error accessing camera:', error);
      setHasCameraPermission(false);
      // Provide more specific error messages
      if (error.name === 'NotAllowedError') {
         setError('Camera access denied. Please grant permission in your browser/OS settings.');
         toast({
           variant: 'destructive',
           title: 'Camera Permission Denied',
           description: 'Allow camera access to scan barcodes.',
         });
      } else if (error.name === 'NotFoundError') {
         setError('No suitable camera found. Ensure a camera is connected and enabled.');
         toast({
           variant: 'destructive',
           title: 'Camera Not Found',
           description: 'Could not find a suitable camera.',
         });
      } else {
        setError(`Camera access error: ${error.message}`);
        toast({
          variant: 'destructive',
          title: 'Camera Error',
          description: `Could not access camera: ${error.message}`,
        });
      }
      setIsInitializing(false);
      stopStream(); // Ensure stream is stopped on error
    }
  };

  // Cleanup on close button click
   const handleCloseDialog = () => {
       stopScanningProcess();
       onClose();
   };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCloseDialog()}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px]"> {/* Adjust width */}
        <DialogHeader>
          <DialogTitle>Scan Barcode</DialogTitle>
          <DialogDescription>
            Position the barcode within the camera view. Click "Start Scan" to begin.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 relative min-h-[200px] flex flex-col items-center justify-center bg-muted rounded-md">
          {/* Initial state or loading */}
          {!isScanningActive && hasCameraPermission !== true && (
             <div className="text-center p-4">
               {isInitializing ? (
                 <>
                   <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                   <p>Initializing camera...</p>
                 </>
               ) : error ? (
                 <Alert variant="destructive">
                   <AlertTitle>Error</AlertTitle>
                   <AlertDescription>{error}</AlertDescription>
                 </Alert>
               ) : (
                  <>
                     <VideoOff className="h-12 w-12 text-muted-foreground mx-auto mb-4"/>
                     <Button onClick={startScan} disabled={isInitializing || hasCameraPermission === false}>
                       <Camera className="mr-2 h-4 w-4" /> Start Scan
                     </Button>
                     {hasCameraPermission === false && !error && (
                        <p className="text-xs text-destructive mt-2">Camera access needed.</p>
                     )}
                  </>
               )}
             </div>
          )}

           {/* Video element - rendered conditionally after permission likely granted */}
           {(isInitializing || (hasCameraPermission === true && isScanningActive)) && (
             <video
               ref={videoRef}
               className="w-full h-auto max-h-[70vh] rounded-md" // Auto height, limit max height
               autoPlay
               playsInline // Important for iOS
               muted // Mute to avoid feedback loops
               style={{ display: isScanningActive ? 'block' : 'none' }} // Hide until scanning starts
             />
           )}
           {/* Show loading specifically during active scanning */}
           {isScanningActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md">
                 <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
           )}


          {/* Error display during active scan (less common) */}
          {hasCameraPermission === true && isScanningActive && error && (
            <Alert variant="destructive" className="mt-4 absolute bottom-4 left-4 right-4 z-10">
              <AlertTitle>Scanning Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCloseDialog}>
             <X className="mr-2 h-4 w-4" /> Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BarcodeScanner;
