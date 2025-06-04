"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, X, Camera, VideoOff, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrowserMultiFormatReader } from "@zxing/browser"; // Import browser-specific parts
import {
  NotFoundException,
  ChecksumException,
  FormatException,
} from "@zxing/library"; // Import core exceptions
import { useTranslation } from "@/hooks/useTranslation"; // Import useTranslation

interface BarcodeScannerProps {
  onBarcodeDetected: (barcode: string) => void;
  onClose: () => void;
}

type ScannerStatus =
  | "idle"
  | "initializing"
  | "permission_denied"
  | "no_devices"
  | "error"
  | "scanning"
  | "no_library";

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onBarcodeDetected,
  onClose,
}) => {
  const { t } = useTranslation(); // Initialize useTranslation
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { toast } = useToast();
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    try {
      readerRef.current = new BrowserMultiFormatReader();
      console.log("ZXing BrowserMultiFormatReader initialized");
      setStatus("idle");
    } catch (error) {
      console.error("Failed to initialize ZXing reader:", error);
      setErrorMessage(t("barcode_scanner_error_library_load"));
      setStatus("no_library");
    }

    return () => {
      isMountedRef.current = false;
      stopScanningProcess();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log(`Camera track stopped: ${track.label}`);
      });
      streamRef.current = null;
    }
    if (readerRef.current) {
      // readerRef.current.reset(); // This method might not exist or cause issues
      console.log(
        "ZXing reader instance persists, but stream tracks are stopped."
      );
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      console.log("Video element paused, srcObject cleared, src removed.");
    }
  }, []);

  const stopScanningProcess = useCallback(() => {
    stopStream();
    if (isMountedRef.current) {
      const currentStatus = status;
      setStatus((prev) =>
        ["scanning", "initializing"].includes(prev) ? "idle" : prev
      );
      console.log(
        `Scanner status set to ${status} from ${currentStatus} after stopping.`
      );
    }
  }, [stopStream, status]);

  const startScan = useCallback(async () => {
    console.log("startScan called. Current status:", status);
    if (
      ![
        "idle",
        "permission_denied",
        "error",
        "no_devices",
        "no_library",
      ].includes(status)
    ) {
      console.log("Scan start prevented. Status:", status);
      return;
    }

    if (!readerRef.current) {
      console.error("ZXing reader not available.");
      setErrorMessage(t("barcode_scanner_error_library_unavailable"));
      setStatus("no_library");
      return;
    }

    setStatus("initializing");
    setErrorMessage(null);
    console.log("Scanner status set to initializing.");

    try {
      console.log("Requesting video input devices list...");
      const videoInputDevices =
        await BrowserMultiFormatReader.listVideoInputDevices();
      if (videoInputDevices.length === 0) {
        console.warn("No video input devices found");
        throw new Error(t("barcode_scanner_error_no_devices_found"));
      }
      console.log("Available video devices:", videoInputDevices);
      const rearCamera = videoInputDevices.find(
        (device) =>
          device.label.toLowerCase().includes("back") ||
          device.label.toLowerCase().includes("environment")
      );
      const selectedDeviceId = rearCamera
        ? rearCamera.deviceId
        : videoInputDevices[0].deviceId;
      console.log(
        `Selected video device ID: ${selectedDeviceId}` +
          (rearCamera
            ? ` (${t("barcode_scanner_rear_camera_preferred")})`
            : ` (${t("barcode_scanner_first_available")})`)
      );

      if (!isMountedRef.current) {
        console.log("Component unmounted during device selection.");
        return;
      }

      if (videoRef.current) {
        console.log(
          `Attempting to get user media with deviceId: ${selectedDeviceId}`
        );
        const constraints: MediaStreamConstraints = {
          video: {
            deviceId: selectedDeviceId
              ? { exact: selectedDeviceId }
              : undefined,
            facingMode: rearCamera ? "environment" : "user",
          },
        };

        try {
          streamRef.current = await navigator.mediaDevices.getUserMedia(
            constraints
          );
        } catch (getUserMediaError: any) {
          console.error("getUserMedia failed:", getUserMediaError);
          if (
            getUserMediaError.name === "NotAllowedError" ||
            getUserMediaError.name === "PermissionDeniedError"
          ) {
            throw new Error(
              t("barcode_scanner_error_permission_denied_getUserMedia")
            );
          } else if (
            getUserMediaError.name === "NotFoundError" ||
            getUserMediaError.name === "DevicesNotFoundError"
          ) {
            throw new Error(
              t("barcode_scanner_error_no_suitable_camera_getUserMedia")
            );
          } else if (
            getUserMediaError.name === "NotReadableError" ||
            getUserMediaError.name === "TrackStartError"
          ) {
            throw new Error(
              t("barcode_scanner_error_camera_in_use_getUserMedia")
            );
          } else if (getUserMediaError.name === "OverconstrainedError") {
            console.warn(
              "OverconstrainedError getting user media, trying without specific device ID",
              getUserMediaError.constraint
            );
            streamRef.current = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: rearCamera ? "environment" : "user" },
            });
          } else {
            throw new Error(
              t("barcode_scanner_error_camera_access_failed_getUserMedia", {
                errorName: getUserMediaError.name,
                errorMessage: getUserMediaError.message,
              })
            );
          }
        }

        console.log("User media stream obtained:", streamRef.current);

        if (!isMountedRef.current) {
          console.log("Component unmounted after getting stream.");
          stopStream();
          return;
        }

        videoRef.current.srcObject = streamRef.current;
        console.log(
          "Assigned stream to video element srcObject. Current srcObject:",
          videoRef.current.srcObject
        );

        videoRef.current.onloadedmetadata = async () => {
          console.log(
            "Video metadata loaded. Video dimensions:",
            videoRef.current?.videoWidth,
            "x",
            videoRef.current?.videoHeight
          );
          try {
            console.log(
              "Attempting to play video element after metadata loaded..."
            );
            await videoRef.current?.play();
            console.log("Video element play() called successfully.");

            if (!isMountedRef.current) {
              console.log("Component unmounted after video play initiated.");
              stopStream();
              return;
            }
            setStatus("scanning");
            console.log(
              "Scanner status set to scanning. Starting ZXing decoding..."
            );

            if (readerRef.current && streamRef.current && videoRef.current) {
              readerRef.current
                .decodeFromStream(
                  streamRef.current,
                  videoRef.current,
                  (result, error) => {
                    if (!isMountedRef.current || status !== "scanning") {
                      return;
                    }
                    if (result) {
                      console.log("ZXing Scan Result:", result.getText());
                      stopScanningProcess();
                      onBarcodeDetected(result.getText());
                    }
                    if (error) {
                      if (
                        !(
                          error instanceof NotFoundException ||
                          error instanceof ChecksumException ||
                          error instanceof FormatException
                        )
                      ) {
                        console.error("ZXing scanning error:", error);
                      }
                    }
                  }
                )
                .catch((decodeError) => {
                  console.error(
                    "Error starting decodeFromStream:",
                    decodeError
                  );
                  if (isMountedRef.current) {
                    setErrorMessage(
                      t("barcode_scanner_error_decode_start_failed", {
                        message: (decodeError as Error).message,
                      })
                    );
                    setStatus("error");
                    stopStream();
                  }
                });
            } else {
              console.error(
                "Missing reader, stream, or video element ref before starting decode."
              );
              if (isMountedRef.current) {
                setErrorMessage(
                  t("barcode_scanner_error_internal_decoder_start")
                );
                setStatus("error");
                stopStream();
              }
            }
          } catch (playError: any) {
            console.error("Error playing video:", playError);
            if (isMountedRef.current) {
              setErrorMessage(
                t("barcode_scanner_error_video_playback", {
                  errorName: playError.name,
                  errorMessage: playError.message,
                })
              );
              setStatus("error");
              stopStream();
            }
          }
        };
        videoRef.current.onerror = (err) => {
          console.error("Video element error event:", err);
          if (isMountedRef.current) {
            setErrorMessage(t("barcode_scanner_error_video_element"));
            setStatus("error");
            stopStream();
          }
        };
        videoRef.current.onstalled = () => {
          console.warn("Video stream stalled.");
        };
        videoRef.current.onplaying = () => {
          console.log("Video element is playing.");
          if (isMountedRef.current && status !== "scanning") {
            setStatus("scanning");
            console.log("Corrected status to 'scanning' on 'onplaying' event.");
          }
        };
        videoRef.current.oncanplay = () => {
          console.log("Video element can play.");
        };
      } else {
        console.error("Video element reference is missing.");
        throw new Error(t("barcode_scanner_error_video_ref_missing"));
      }
    } catch (error: any) {
      console.error("Error starting scan:", error);
      if (!isMountedRef.current) return;

      let userMessage = t("barcode_scanner_error_generic_camera_scan", {
        message: error.message,
      });
      let newStatus: ScannerStatus = "error";

      if (error.message?.toLowerCase().includes("permission denied")) {
        userMessage = t("barcode_scanner_error_permission_denied_settings");
        newStatus = "permission_denied";
        toast({
          variant: "destructive",
          title: t("barcode_scanner_toast_permission_denied_title"),
          description: t("barcode_scanner_toast_permission_denied_desc"),
        });
      } else if (
        error.message
          ?.toLowerCase()
          .includes("no suitable camera device found") ||
        error.message?.toLowerCase().includes("no camera devices found")
      ) {
        userMessage = t("barcode_scanner_error_no_suitable_camera_connect");
        newStatus = "no_devices";
        toast({
          variant: "destructive",
          title: t("barcode_scanner_toast_camera_not_found_title"),
          description: t("barcode_scanner_toast_camera_not_found_desc"),
        });
      } else if (
        error.message?.toLowerCase().includes("already in use") ||
        error.message?.toLowerCase().includes("hardware error")
      ) {
        userMessage = t("barcode_scanner_error_camera_in_use_hardware");
        newStatus = "error";
        toast({
          variant: "destructive",
          title: t("barcode_scanner_toast_camera_access_issue_title"),
          description: userMessage,
        });
      } else if (
        error.name === "NotSupportedError" ||
        error.message?.toLowerCase().includes("getusermedia is not supported")
      ) {
        userMessage = t("barcode_scanner_error_not_supported_browser");
        newStatus = "error";
        toast({
          variant: "destructive",
          title: t("barcode_scanner_toast_not_supported_title"),
          description: userMessage,
        });
      } else {
        toast({
          variant: "destructive",
          title: t("barcode_scanner_toast_camera_error_title"),
          description: t("barcode_scanner_toast_camera_error_desc", {
            message: error.message,
          }),
        });
      }
      setErrorMessage(userMessage);
      setStatus(newStatus);
      stopScanningProcess();
    }
  }, [status, onBarcodeDetected, stopScanningProcess, stopStream, toast, t]);

  const handleCloseDialog = () => {
    console.log("Closing dialog, stopping scan process...");
    stopScanningProcess();
    onClose();
  };

  const renderContent = () => {
    switch (status) {
      case "initializing":
        return (
          <div className="text-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
            <p>{t("barcode_scanner_status_initializing")}</p>
            <video
              ref={videoRef}
              className="absolute w-px h-px -left-full"
              playsInline
              muted
              autoPlay
            />
          </div>
        );
      case "scanning":
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
              <Alert
                variant="destructive"
                className="mt-4 absolute bottom-4 left-4 right-4 z-10 opacity-80"
              >
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
          </>
        );
      case "no_library":
      case "permission_denied":
      case "no_devices":
      case "error":
        return (
          <div className="text-center p-4 space-y-4">
            <Alert variant="destructive">
              {status === "permission_denied" ? (
                <VideoOff className="h-4 w-4" />
              ) : status === "no_devices" ? (
                <Camera className="h-4 w-4" />
              ) : status === "no_library" ? (
                <WifiOff className="h-4 w-4" />
              ) : (
                <WifiOff className="h-4 w-4" />
              )}
              <AlertTitle>
                {status === "no_library"
                  ? t("barcode_scanner_alert_title_unavailable")
                  : status === "permission_denied"
                  ? t("barcode_scanner_alert_title_permission_denied")
                  : status === "no_devices"
                  ? t("barcode_scanner_alert_title_no_camera")
                  : t("barcode_scanner_alert_title_error")}
              </AlertTitle>
              <AlertDescription>
                {errorMessage ||
                  t("barcode_scanner_alert_desc_unexpected_error")}
              </AlertDescription>
            </Alert>
            {(status === "permission_denied" ||
              status === "error" ||
              status === "no_devices") && (
              <Button onClick={startScan}>
                <Camera className="mr-2 h-4 w-4" />{" "}
                {t("barcode_scanner_button_retry_scan")}
              </Button>
            )}
            <video
              ref={videoRef}
              className="absolute w-px h-px -left-full"
              playsInline
              muted
              autoPlay
            />
          </div>
        );
      case "idle":
      default:
        return (
          <div className="text-center p-4 space-y-4">
            <VideoOff className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <Button onClick={startScan}>
              <Camera className="mr-2 h-4 w-4" />{" "}
              {t("barcode_scanner_button_start_scan")}
            </Button>
            {errorMessage && (
              <p className="text-xs text-destructive mt-2">{errorMessage}</p>
            )}
            <video
              ref={videoRef}
              className="absolute w-px h-px -left-full"
              playsInline
              muted
              autoPlay
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCloseDialog()}>
      <DialogContent className="sm:max-w-[425px] md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("barcode_scanner_dialog_title")}</DialogTitle>
          <DialogDescription>
            {t("barcode_scanner_dialog_description_position")}{" "}
            {status === "idle"
              ? t("barcode_scanner_dialog_description_click_start")
              : status === "scanning"
              ? t("barcode_scanner_dialog_description_scanning")
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 relative min-h-[200px] flex flex-col items-center justify-center bg-muted rounded-md overflow-hidden">
          {renderContent()}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCloseDialog}>
            <X className="mr-2 h-4 w-4" /> {t("cancel_button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BarcodeScanner;
