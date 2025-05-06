
'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, X, Camera, VideoOff, WifiOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BrowserMultiFormatReader } from '@zxing/browser'; // Import browser-specific parts
// Import core exceptions - These are typically part of @zxing/library
import { NotFoundException, ChecksumException, FormatException }
from '@zxing/library';


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
        readerRef.current = new BrowserMultiFormatReader(undefined, 500); // Added hints and timeBetweenScans
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
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log(`Camera track stopped: ${track.label}`);
      });
      streamRef.current = null;
    }
     if (readerRef.current) {
        // readerRef.current.reset(); // Removed as it caused errors
        console.log("ZXing reader instance persists, but stream tracks are stopped.");
     }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause(); // Explicitly pause video
      videoRef.current.removeAttribute('src'); // Remove src attribute as well
      console.log("Video element paused, srcObject cleared, src removed.");
    }
  }, []);

  const stopScanningProcess = useCallback(() => {
    stopStream();
    if (isMountedRef.current) {
       const currentStatus = status;
       setStatus(prev => ['scanning', 'initializing'].includes(prev) ? 'idle' : prev);
       console.log(`Scanner status set to ${status} from ${currentStatus} after stopping.`);
    }
  }, [stopStream, status]);

  // Function to start scanning using zxing
  const startScan = useCallback(async () => {
     console.log('startScan called. Current status:', status);
     if (!['idle', 'permission_denied', 'error', 'no_devices', 'no_library'].includes(status)) {
         console.log('Scan start prevented. Status:', status);
         return;
     }

     if (!readerRef.current) {
       console.error("ZXing reader not available.");
       setErrorMessage("Barcode scanning library not available.");
       setStatus('no_library');
       return;
     }

     setStatus('initializing');
     setErrorMessage(null);
     console.log('Scanner status set to initializing.');

     try {
        console.log("Requesting video input devices list...");
        const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
            console.warn("No video input devices found");
            throw new Error("No camera devices found.");
        }
        console.log("Available video devices:", videoInputDevices);
        const rearCamera = videoInputDevices.find(device => device.label.toLowerCase().includes('back') || device.label.toLowerCase().includes('environment'));
        const selectedDeviceId = rearCamera ? rearCamera.deviceId : videoInputDevices[0].deviceId;
        console.log(`Selected video device ID: ${selectedDeviceId}` + (rearCamera ? ' (Rear camera preferred)' : ' (First available)'));

        if (!isMountedRef.current) {
           console.log("Component unmounted during device selection.");
           return;
        }

        if (videoRef.current) {
             console.log(`Attempting to get user media with deviceId: ${selectedDeviceId}`);
             const constraints: MediaStreamConstraints = {
                 video: {
                     deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                     facingMode: rearCamera ? 'environment' : 'user',
                 }
             };

             try {
                streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
             } catch (getUserMediaError: any) {
                 console.error("getUserMedia failed:", getUserMediaError);
                 if (getUserMediaError.name === 'NotAllowedError' || getUserMediaError.name === 'PermissionDeniedError') {
                     throw new Error('Camera permission denied.');
                 } else if (getUserMediaError.name === 'NotFoundError' || getUserMediaError.name === 'DevicesNotFoundError') {
                     throw new Error('No suitable camera device found.');
                 } else if (getUserMediaError.name === 'NotReadableError' || getUserMediaError.name === 'TrackStartError') {
                      throw new Error('Camera is already in use or hardware error.');
                 } else if (getUserMediaError.name === 'OverconstrainedError') {
                      console.warn('OverconstrainedError getting user media, trying without specific device ID', getUserMediaError.constraint);
                       streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: rearCamera ? 'environment' : 'user' } });
                 } else {
                     throw new Error(`Failed to access camera: ${getUserMediaError.name} - ${getUserMediaError.message}`);
                 }
             }

             console.log("User media stream obtained:", streamRef.current);

             if (!isMountedRef.current) {
                 console.log("Component unmounted after getting stream.");
                 stopStream();
                 return;
             }

             videoRef.current.srcObject = streamRef.current;
             console.log("Assigned stream to video element srcObject. Current srcObject:", videoRef.current.srcObject);

             videoRef.current.onloadedmetadata = async () => {
                 console.log("Video metadata loaded. Video dimensions:", videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight);
                 try {
                     console.log("Attempting to play video element after metadata loaded...");
                     await videoRef.current?.play();
                     console.log("Video element play() called successfully.");

                     if (!isMountedRef.current) {
                         console.log("Component unmounted after video play initiated.");
                         stopStream();
                         return;
                     }
                     setStatus('scanning');
                     console.log("Scanner status set to scanning. Starting ZXing decoding...");

                     if (readerRef.current && streamRef.current && videoRef.current) {
                         readerRef.current.decodeFromStream(streamRef.current, videoRef.current, (result, error) => {
                             if (!isMountedRef.current || status !== 'scanning') {
                                 return;
                             }
                             if (result) {
                                 console.log('ZXing Scan Result:', result.getText());
                                 stopScanningProcess();
                                 onBarcodeDetected(result.getText());
                             }
                             if (error) {
                                 if (!(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
                                     console.error('ZXing scanning error:', error);
                                 }
                             }
                         }).catch(decodeError => {
                            console.error("Error starting decodeFromStream:", decodeError);
                            if (isMountedRef.current) {
                                setErrorMessage(`Failed to start barcode decoding: ${ (decodeError as Error).message}`);
                                setStatus('error');
                                stopStream();
                            }
                         });
                     } else {
                        console.error("Missing reader, stream, or video element ref before starting decode.");
                         if (isMountedRef.current) {
                            setErrorMessage("Internal error: Cannot start decoder.");
                            setStatus('error');
                            stopStream();
                         }
                     }
                 } catch (playError: any) {
                     console.error("Error playing video:", playError);
                     if (isMountedRef.current) {
                         setErrorMessage(`Could not start camera video playback: ${playError.name} - ${playError.message}`);
                         setStatus('error');
                         stopStream();
                     }
                 }
             };
             videoRef.current.onerror = (err) => {
                 console.error("Video element error event:", err);
                 if (isMountedRef.current) {
                      setErrorMessage(`Video element encountered an error.`);
                      setStatus('error');
                      stopStream();
                 }
             };
              videoRef.current.onstalled = () => {
                 console.warn("Video stream stalled.");
              };
              videoRef.current.onplaying = () => {
                 console.log("Video element is playing.");
                 if (isMountedRef.current && status !== 'scanning') {
                     setStatus('scanning');
                     console.log("Corrected status to 'scanning' on 'onplaying' event.");
                 }
              };
              videoRef.current.oncanplay = () => {
                  console.log("Video element can play.");
              };
        } else {
          console.error("Video element reference is missing.");
          throw new Error("Video element reference is missing.");
        }

     } catch (error: any) {
       console.error('Error starting scan:', error);
       if (!isMountedRef.current) return;

       let userMessage = `Camera/Scan error: ${error.message}`;
       let newStatus: ScannerStatus = 'error';

        if (error.message?.toLowerCase().includes('permission denied')) {
         userMessage = 'Camera access denied. Please grant permission in your browser/OS settings.';
         newStatus = 'permission_denied';
         toast({
           variant: 'destructive',
           title: 'Camera Permission Denied',
           description: 'Allow camera access to scan barcodes.',
         });
        } else if (error.message?.toLowerCase().includes('no suitable camera device found') || error.message?.toLowerCase().includes('no camera devices found')) {
            userMessage = 'No suitable camera found. Ensure a camera is connected and enabled.';
            newStatus = 'no_devices';
            toast({
                variant: 'destructive',
                title: 'Camera Not Found',
                description: 'Could not find a suitable camera.',
            });
         } else if (error.message?.toLowerCase().includes('already in use') || error.message?.toLowerCase().includes('hardware error')) {
             userMessage = 'Camera is already in use by another application or encountered a hardware issue.';
             newStatus = 'error';
             toast({
                 variant: 'destructive',
                 title: 'Camera Access Issue',
                 description: userMessage,
             });
         } else if (error.name === 'NotSupportedError' || error.message?.toLowerCase().includes('getusermedia is not supported')) {
             userMessage = 'Camera access or barcode scanning is not supported by your browser or device. Ensure you are using HTTPS and a compatible browser (e.g., not all features work on iOS Safari in all contexts).';
             newStatus = 'error';
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
       stopScanningProcess();
     }
  }, [status, onBarcodeDetected, stopScanningProcess, stopStream, toast]);

  const handleCloseDialog = () => {
    console.log("Closing dialog, stopping scan process...");
    stopScanningProcess();
    onClose();
  };

  const renderContent = () => {
    switch (status) {
      case 'initializing':
        return (
          <div className="text-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
            <p>Initializing camera...</p>
            <video ref={videoRef} className="absolute w-px h-px -left-full" playsInline muted autoPlay />
          </div>
        );
      case 'scanning':
        return (
          <>
            <video
                ref={videoRef}
                className="w-full h-auto max-h-[70vh] rounded-md bg-gray-800"
                playsInline
                muted
                autoPlay
                controls={false}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-transparent rounded-md pointer-events-none">
              <div className="w-3/4 h-1/2 border-2 border-dashed border-white/80 rounded-lg" />
            </div>
             {errorMessage && (
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
                    {status === 'permission_denied' ? <VideoOff className="h-4 w-4" /> :
                     status === 'no_devices' ? <Camera className="h-4 w-4" /> :
                     status === 'no_library' ? <WifiOff className="h-4 w-4" /> :
                     <WifiOff className="h-4 w-4" />}
                    <AlertTitle>
                        {status === 'no_library' ? 'Scanner Unavailable' :
                        status === 'permission_denied' ? 'Permission Denied' :
                        status === 'no_devices' ? 'No Camera Found' : 'Error'}
                    </AlertTitle>
                    <AlertDescription>{errorMessage || 'An unexpected error occurred.'}</AlertDescription>
                </Alert>
                {(status === 'permission_denied' || status === 'error' || status === 'no_devices') && (
                    <Button onClick={startScan}>
                        <Camera className="mr-2 h-4 w-4" /> Retry Scan
                    </Button>
                )}
                 <video ref={videoRef} className="absolute w-px h-px -left-full" playsInline muted autoPlay/>
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
             {errorMessage && (
                <p className="text-xs text-destructive mt-2">{errorMessage}</p>
             )}
              <video ref={videoRef} className="absolute w-px h-px -left-full" playsInline muted autoPlay/>
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

    