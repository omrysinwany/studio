
'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface BarcodeScannerProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onBarcodeDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // null initially, true/false after check
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const barcodeDetectorRef = useRef<any>(null); // Ref to hold the detector instance
  const streamRef = useRef<MediaStream | null>(null); // Ref to hold the camera stream

  // Initialize BarcodeDetector if supported
  useEffect(() => {
    if ('BarcodeDetector' in window) {
      try {
        // @ts-ignore - BarcodeDetector might not be fully typed yet
        barcodeDetectorRef.current = new window.BarcodeDetector({ formats: ['ean_13', 'upc_a', 'code_128'] }); // Adjust formats as needed
        console.log("BarcodeDetector initialized");
      } catch (e: any) {
        console.error("Error initializing BarcodeDetector:", e);
        setError(`Barcode Detector initialization failed: ${e.message}. Scanning might not work.`);
      }
    } else {
      console.warn("BarcodeDetector API not supported in this browser.");
      setError("Barcode scanning is not supported by your browser.");
    }
  }, []);


  // Get camera permission and start stream
  useEffect(() => {
    const getCameraPermission = async () => {
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); // Prefer rear camera
        setHasCameraPermission(true);
        setError(null); // Clear previous errors
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play(); // Ensure video plays
          console.log("Camera stream started");
        }
      } catch (error: any) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        setError(`Camera access denied or error: ${error.message}`);
        toast({
          variant: 'destructive',
          title: 'Camera Access Denied',
          description: 'Please enable camera permissions to scan barcodes.',
        });
      }
    };

    getCameraPermission();

    // Cleanup function to stop the stream when the component unmounts or dialog closes
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        console.log("Camera stream stopped");
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null; // Release the source object
      }
    };
  }, [toast]); // Dependency array includes toast


  // Barcode detection logic
  const detectBarcode = useCallback(async () => {
    if (!videoRef.current || !barcodeDetectorRef.current || videoRef.current.readyState < videoRef.current.HAVE_METADATA || !hasCameraPermission) {
      // console.log("Conditions not met for detection:", { videoReady: videoRef.current?.readyState, detector: !!barcodeDetectorRef.current, permission: hasCameraPermission });
      return; // Wait until video is ready, detector is initialized, and permission granted
    }

    try {
      // @ts-ignore
      const barcodes = await barcodeDetectorRef.current.detect(videoRef.current);
      // console.log("Detection attempt, barcodes found:", barcodes); // Log detection attempts
      if (barcodes.length > 0) {
        const firstBarcode = barcodes[0].rawValue;
        console.log('Barcode detected:', firstBarcode);
        onBarcodeDetected(firstBarcode); // Call the callback prop
        // No need to call onClose here, let the parent handle it after receiving the barcode
      }
    } catch (e: any) {
      console.error('Error detecting barcode:', e);
      // Don't set general error, maybe log or show temporary detection error?
    }
  }, [onBarcodeDetected, hasCameraPermission]); // Include dependencies


  // Continuously try to detect barcode
  useEffect(() => {
     let intervalId: NodeJS.Timeout | null = null;
     if (hasCameraPermission && barcodeDetectorRef.current && videoRef.current) {
       console.log("Starting barcode detection interval");
       intervalId = setInterval(detectBarcode, 500); // Adjust interval as needed (e.g., 500ms)
     } else {
        console.log("Not starting detection interval, conditions not met:", { perm: hasCameraPermission, detector: !!barcodeDetectorRef.current, video: !!videoRef.current });
     }

     return () => {
       if (intervalId) {
         console.log("Clearing barcode detection interval");
         clearInterval(intervalId);
       }
     };
  }, [hasCameraPermission, detectBarcode]); // Depend on permission and detect function


  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px]"> {/* Adjust width */}
        <DialogHeader>
          <DialogTitle>Scan Barcode</DialogTitle>
          <DialogDescription>
            Position the barcode within the camera view.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 relative">
          {hasCameraPermission === null && (
             <div className="flex justify-center items-center h-48">
               <Loader2 className="h-8 w-8 animate-spin text-primary" />
               <span className="ml-2">Requesting camera access...</span>
             </div>
          )}

          {/* Video element always rendered to attach stream */}
          <video
              ref={videoRef}
              className={`w-full aspect-video rounded-md bg-muted ${hasCameraPermission === false ? 'hidden' : ''}`}
              autoPlay
              playsInline // Important for iOS
              muted // Mute to avoid feedback loops if microphone also active
            />

          {hasCameraPermission === false && error && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Camera Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
           {hasCameraPermission === true && error && !error.startsWith("Camera access denied") && ( // Show non-permission errors if permission is granted
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Scanning Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
             <X className="mr-2 h-4 w-4" /> Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BarcodeScanner;
