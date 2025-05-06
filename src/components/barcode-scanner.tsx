
'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, X, Camera, VideoOff, WifiOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BrowserMultiFormatReader } from '@zxing/browser'; // Import browser-specific parts
import { NotFoundException, ChecksumException, FormatException } from '@zxing/library'; // Import core exceptions

interface BarcodeScannerProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
}

type ScannerStatus = 'idle' | 'initializing' | 'permission_denied' | 'no_devices' | 'error' | 'scanning' | 'no_library';

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onBarcodeDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const readerRef = useRef<BrowserMultiFormatReader | null>(null); // Ref for zxing reader
  const streamRef = useRef<MediaStream | null>(null); // Ref for the camera stream
  const isMountedRef = useRef(true); // Track mount status

  // Initialize the reader on mount
  useEffect(() => {
    isMountedRef.current = true;
    try {
        readerRef.current = new BrowserMultiFormatReader();
        console.log("ZXing BrowserMultiFormatReader initialized");
        setStatus('idle');
    } catch (error) {
        console.error("Failed to initialize ZXing reader:", error);
        setErrorMessage("Barcode scanning library failed to load.");
        setStatus('no_library');
    }

    return () => {
      isMountedRef.current = false;
      stopScanningProcess(); // Cleanup on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      console.log("Camera stream stopped");
      streamRef.current = null;
    }
     if (readerRef.current) {
        // The BrowserMultiFormatReader instance itself doesn't have a public reset method.
        // Stopping the tracks and clearing the video source is the primary way to stop scanning.
        // readerRef.current.reset(); // REMOVED - This method does not exist on the instance.
        console.log("ZXing reader stream stopped (no specific reset method called).");
     }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopScanningProcess = useCallback(() => {
    stopStream();
    if (isMountedRef.current) {
      // Only set status if mounted, avoid setting idle if there was an error
      setStatus(prev => ['scanning', 'initializing'].includes(prev) ? 'idle' : prev);
    }
  }, [stopStream]);

  // Function to start scanning using zxing
  const startScan = useCallback(async () => {
     if (status !== 'idle' && status !== 'permission_denied' && status !== 'error' && status !== 'no_devices') return; // Allow retry

     if (!readerRef.current) {
       setErrorMessage("Barcode scanning library not available.");
       setStatus('no_library');
       return;
     }

     setStatus('initializing');
     setErrorMessage(null);

     try {
        // List video devices to ensure camera access and selection
        const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
            console.warn("No video input devices found");
            throw new Error("No camera devices found."); // Treat as specific error
        }
        const firstDeviceId = videoInputDevices[0].deviceId; // Use the first available device

        if (!isMountedRef.current) return; // Check mount status

        // Start decoding from the selected video device
        if (videoRef.current) {
             console.log(`Starting ZXing scan with device: ${firstDeviceId}`);
             // Start decoding continuously
             // Ensure constraints allow Safari to function correctly
             const constraints: MediaStreamConstraints = {
                 video: {
                     deviceId: firstDeviceId,
                     // Add common Safari/iOS constraints
                     facingMode: 'environment', // Prefer rear camera
                 }
             };
             streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);


             if (!isMountedRef.current) {
                 stopStream();
                 return;
             }

             videoRef.current.srcObject = streamRef.current;
             // Safari compatibility: Ensure video plays inline and muted
             videoRef.current.playsInline = true;
             videoRef.current.muted = true;

             // Add event listener to ensure video plays before starting decoder
             videoRef.current.onloadedmetadata = () => {
                if(videoRef.current && isMountedRef.current) {
                    videoRef.current.play().then(() => {
                        if (!isMountedRef.current || status === 'scanning') return; // Double check after play starts
                        setStatus('scanning');
                        console.log("ZXing scanning started after video played");

                        readerRef.current?.decodeFromStream(streamRef.current!, videoRef.current!, (result, error) => {
                            if (!isMountedRef.current || status !== 'scanning') return; // Check mount status and if still scanning

                            if (result) {
                                console.log('ZXing Scan Result:', result.getText());
                                stopScanningProcess();
                                onBarcodeDetected(result.getText());
                            }

                            if (error) {
                                // Ignore common scanning errors (NotFoundException means no barcode found in frame)
                                // Also ignore ChecksumException and FormatException which can occur during scanning attempts
                                if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
                                console.error('ZXing scanning error:', error);
                                // Only show critical errors, ignore 'no barcode' type errors
                                // setErrorMessage(`Scanning error: ${error.message}`);
                                }
                            }
                        });
                    }).catch(playError => {
                        console.error("Error playing video:", playError);
                        if(isMountedRef.current) {
                             setErrorMessage("Could not start camera video playback.");
                             setStatus('error');
                             stopStream();
                        }
                    });
                }
            };
             videoRef.current.load(); // Trigger loading metadata

        } else {
          throw new Error("Video element reference is missing.");
        }

     } catch (error: any) {
       console.error('Error starting scan:', error);
       if (!isMountedRef.current) return;

       let userMessage = `Camera/Scan error: ${error.message}`;
       let newStatus: ScannerStatus = 'error';

       if (error.name === 'NotAllowedError' || error.message?.includes('Permission denied')) {
         userMessage = 'Camera access denied. Please grant permission in your browser/OS settings.';
         newStatus = 'permission_denied';
         toast({
           variant: 'destructive',
           title: 'Camera Permission Denied',
           description: 'Allow camera access to scan barcodes.',
         });
        } else if (error.message?.includes('No camera devices found')) {
            userMessage = 'No suitable camera found. Ensure a camera is connected and enabled.';
            newStatus = 'no_devices';
            toast({
                variant: 'destructive',
                title: 'Camera Not Found',
                description: 'Could not find a suitable camera.',
            });
         } else if (error.name === 'NotSupportedError' || error.message?.includes('getUserMedia is not supported')) {
             userMessage = 'Camera access or barcode scanning is not supported by your browser or device.';
             newStatus = 'error'; // Or a more specific status if needed
             toast({
                 variant: 'destructive',
                 title: 'Scanning Not Supported',
                 description: userMessage,
             });
         } else {
            toast({
                variant: 'destructive',
                title: 'Camera Error',
                description: `Could not access camera or start scan: ${error.message}`,
            });
        }
       setErrorMessage(userMessage);
       setStatus(newStatus);
       stopScanningProcess(); // Ensure cleanup on error
     }
  }, [status, onBarcodeDetected, stopScanningProcess, stopStream, toast]); // Include dependencies

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
            {/* Video element is needed for the library */}
            <video ref={videoRef} className="absolute w-px h-px -left-full" playsInline muted />
          </div>
        );
      case 'scanning':
        return (
          <>
            {/* Video element is required by zxing */}
            <video ref={videoRef} className="w-full h-auto max-h-[70vh] rounded-md" playsInline muted />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md pointer-events-none">
              <div className="w-3/4 h-1/2 border-2 border-dashed border-white/80 rounded-lg" />
            </div>
             {errorMessage && ( // Show non-critical errors during scan if needed
                 <Alert variant="destructive" className="mt-4 absolute bottom-4 left-4 right-4 z-10 opacity-80">
                   <AlertDescription>{errorMessage}</AlertDescription>
                 </Alert>
             )}
          </>
        );
        case 'no_library':
        case 'permission_denied':
        case 'no_devices':
        case 'error':
            return (
            <div className="text-center p-4 space-y-4">
                <Alert variant="destructive">
                    <WifiOff className="h-4 w-4" /> {/* Generic error icon */}
                    <AlertTitle>
                        {status === 'no_library' ? 'Scanner Unavailable' :
                        status === 'permission_denied' ? 'Permission Denied' :
                        status === 'no_devices' ? 'No Camera Found' : 'Error'}
                    </AlertTitle>
                    <AlertDescription>{errorMessage || 'An unexpected error occurred.'}</AlertDescription>
                </Alert>
                {/* Allow retry if it was a permission issue or generic error */}
                {(status === 'permission_denied' || status === 'error' || status === 'no_devices') && (
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
        {/* Ensure video container allows overflow if needed, though video scales now */}
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
