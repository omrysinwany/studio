'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, X, Camera, VideoOff, WifiOff } from 'lucide-react'; // Added WifiOff for generic error
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface BarcodeScannerProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
}

type ScannerStatus = 'idle' | 'initializing' | 'no_detector' | 'no_permission' | 'error' | 'scanning';

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onBarcodeDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const barcodeDetectorRef = useRef<any>(null); // Ref to hold the detector instance
  const streamRef = useRef<MediaStream | null>(null); // Ref to hold the camera stream
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for the detection interval
  const isMountedRef = useRef(true); // Track mount status for async operations

  // Check BarcodeDetector support on mount
  useEffect(() => {
    isMountedRef.current = true;
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore - BarcodeDetector might not be fully typed yet
        barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['ean_13', 'upc_a', 'code_128'] }); // Adjust formats as needed
        console.log("BarcodeDetector initialized");
        setStatus('idle'); // Ready to start if detector is okay
        setErrorMessage(null);
      } catch (e: any) {
        console.error("Error initializing BarcodeDetector:", e);
        setErrorMessage(`Barcode Detector initialization failed: ${e.message || 'Unknown error'}.`);
        setStatus('no_detector');
      }
    } else {
      console.warn("BarcodeDetector API not supported in this browser.");
      setErrorMessage("Barcode scanning is not supported by your browser.");
      setStatus('no_detector');
    }

    // Cleanup function
    return () => {
      isMountedRef.current = false;
      stopScanningProcess(); // Stop stream and interval on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only once

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      console.log("Camera stream stopped");
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null; // Release the source object
    }
  }, []);

  const stopDetectionInterval = useCallback(() => {
    if (detectionIntervalRef.current) {
      console.log("Clearing barcode detection interval");
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
  }, []);

  const stopScanningProcess = useCallback(() => {
    stopDetectionInterval();
    stopStream();
    if (isMountedRef.current) {
      // Only set status if component is still mounted
      // Check current status to avoid setting idle if error occurred
      setStatus(prev => prev === 'scanning' || prev === 'initializing' ? 'idle' : prev);
    }
  }, [stopDetectionInterval, stopStream]);

  // Barcode detection logic
  const detectBarcode = useCallback(async () => {
    if (!isMountedRef.current || status !== 'scanning' || !videoRef.current || !barcodeDetectorRef.current || videoRef.current.readyState < videoRef.current.HAVE_METADATA) {
      return;
    }

    try {
      // @ts-ignore
      const barcodes = await barcodeDetectorRef.current.detect(videoRef.current);
      if (barcodes.length > 0 && isMountedRef.current && status === 'scanning') { // Re-check status and mount state
        const firstBarcode = barcodes[0].rawValue;
        console.log('Barcode detected:', firstBarcode);
        stopScanningProcess(); // Stop scanning after detection
        onBarcodeDetected(firstBarcode); // Call the callback
      }
    } catch (e: any) {
      console.error('Error detecting barcode:', e);
      if (isMountedRef.current) {
        setErrorMessage(`Error during barcode detection: ${e.message}`);
        setStatus('error');
      }
      stopScanningProcess(); // Stop on error
    }
  }, [onBarcodeDetected, stopScanningProcess, status]); // Add status dependency

  // Function to request permission and start the stream/detection
  const startScan = useCallback(async () => {
    if (status !== 'idle' && status !== 'no_permission' && status !== 'error') return; // Allow retry from error/no_permission

    if (!barcodeDetectorRef.current) {
      setErrorMessage("Barcode Detector is not available or failed to initialize.");
      setStatus('no_detector');
      return;
    }

    setStatus('initializing');
    setErrorMessage(null);

    try {
      // Request camera permission
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // Prefer rear camera

      if (!isMountedRef.current) { // Check if component unmounted during permission request
        stopStream();
        return;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        // Wait for video metadata to load before playing and starting detection
        videoRef.current.onloadedmetadata = async () => {
            try {
                // Ensure we are still initializing and component is mounted
                if (!isMountedRef.current || status !== 'initializing') {
                   stopStream();
                   return;
                }
                await videoRef.current?.play(); // Ensure video plays
                console.log("Camera stream started and playing");
                setStatus('scanning'); // Activate scanning loop

                // Start detection interval *after* video is playing
                if (!detectionIntervalRef.current) {
                    console.log("Starting barcode detection interval");
                    detectionIntervalRef.current = setInterval(detectBarcode, 500); // Start detection loop
                }
            } catch (playError: any) {
                 console.error('Error playing video stream:', playError);
                 if (isMountedRef.current) {
                    setErrorMessage(`Could not start video stream: ${playError.message}`);
                    setStatus('error');
                 }
                 stopStream(); // Clean up stream if play fails
            }
        };
         videoRef.current.onerror = (e) => {
             console.error('Video element error:', e);
             if (isMountedRef.current) {
                 setErrorMessage('An error occurred with the video stream.');
                 setStatus('error');
             }
             stopStream();
         };

      } else {
         throw new Error("Video element reference is missing.");
      }

    } catch (error: any) {
      console.error('Error accessing camera:', error);
       if (!isMountedRef.current) return; // Check if component unmounted during error handling

      let userMessage = `Camera access error: ${error.message}`;
      let newStatus: ScannerStatus = 'error';

      if (error.name === 'NotAllowedError') {
         userMessage = 'Camera access denied. Please grant permission in your browser/OS settings.';
         newStatus = 'no_permission';
         toast({
           variant: 'destructive',
           title: 'Camera Permission Denied',
           description: 'Allow camera access to scan barcodes.',
         });
      } else if (error.name === 'NotFoundError') {
         userMessage = 'No suitable camera found. Ensure a camera is connected and enabled.';
         toast({
           variant: 'destructive',
           title: 'Camera Not Found',
           description: 'Could not find a suitable camera.',
         });
      } else {
        toast({
          variant: 'destructive',
          title: 'Camera Error',
          description: `Could not access camera: ${error.message}`,
        });
      }
      setErrorMessage(userMessage);
      setStatus(newStatus);
      stopStream(); // Ensure stream is stopped on error
    }
  }, [status, detectBarcode, stopStream, toast]); // Include dependencies

  // Cleanup on close button click
  const handleCloseDialog = () => {
    stopScanningProcess();
    onClose();
  };

  // --- Render UI based on status ---
  const renderContent = () => {
    switch (status) {
      case 'initializing':
        return (
          <div className="text-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
            <p>Initializing camera...</p>
            {/* Video element is rendered hidden during initialization */}
            <video ref={videoRef} className="absolute w-px h-px -left-full" autoPlay playsInline muted />
          </div>
        );
      case 'scanning':
        return (
          <>
            <video ref={videoRef} className="w-full h-auto max-h-[70vh] rounded-md" autoPlay playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md pointer-events-none">
              <div className="w-3/4 h-1/2 border-2 border-dashed border-white/80 rounded-lg" />
              {/* Optional: Add text like "Scanning..." */}
            </div>
            {errorMessage && ( // Show error during scan if it occurs
                <Alert variant="destructive" className="mt-4 absolute bottom-4 left-4 right-4 z-10">
                  <AlertTitle>Scanning Error</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
            )}
          </>
        );
      case 'no_detector':
      case 'no_permission':
      case 'error':
        return (
          <div className="text-center p-4 space-y-4">
             <Alert variant="destructive">
               <WifiOff className="h-4 w-4" /> {/* Generic error icon */}
               <AlertTitle>{status === 'no_detector' ? 'Not Supported' : status === 'no_permission' ? 'Permission Denied' : 'Error'}</AlertTitle>
               <AlertDescription>{errorMessage || 'An unexpected error occurred.'}</AlertDescription>
             </Alert>
             {/* Allow retry if it was a permission issue or generic error */}
             {(status === 'no_permission' || status === 'error') && (
                <Button onClick={startScan}>
                   <Camera className="mr-2 h-4 w-4" /> Retry Scan
                </Button>
             )}
          </div>
        );
      case 'idle':
      default:
        return (
          <div className="text-center p-4 space-y-4">
            <VideoOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <Button onClick={startScan}>
              <Camera className="mr-2 h-4 w-4" /> Start Scan
            </Button>
             {errorMessage && ( // Show previous error message if any
                <p className="text-xs text-destructive mt-2">{errorMessage}</p>
             )}
          </div>
        );
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCloseDialog()}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Scan Barcode</DialogTitle>
          <DialogDescription>
            Position the barcode within the camera view. {status === 'idle' ? 'Click "Start Scan" to begin.' : status === 'scanning' ? 'Scanning...' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 relative min-h-[200px] flex flex-col items-center justify-center bg-muted rounded-md overflow-hidden">
          {renderContent()}
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

    