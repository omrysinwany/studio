'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, UploadCloud, Image as ImageIconLucide, X } from 'lucide-react'; // Renamed to avoid conflict
import NextImage from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

interface PaymentReceiptUploadDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  invoiceFileName: string;
  onConfirmUpload: (receiptImageUri: string) => Promise<void>;
}

async function compressImage(base64Str: string, quality = 0.6, maxWidth = 800, maxHeight = 800): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new window.Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Failed to get canvas context'));
            }
            ctx.drawImage(img, 0, 0, width, height);
            const mimeType = base64Str.substring(base64Str.indexOf(':') + 1, base64Str.indexOf(';'));
            const outputMimeType = (mimeType === 'image/png') ? 'image/png' : 'image/jpeg';
            resolve(canvas.toDataURL(outputMimeType, quality));
        };
        img.onerror = (error) => {
            console.error("Image load error for compression:", error);
            reject(new Error('Failed to load image for compression'));
        };
    });
}


const PaymentReceiptUploadDialog: React.FC<PaymentReceiptUploadDialogProps> = ({
  isOpen,
  onOpenChange,
  invoiceFileName,
  onConfirmUpload,
}) => {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
      if (validTypes.includes(file.type) || file.type.startsWith('image/')) {
        setSelectedFile(file);
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
              setPreviewUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        } else {
            setPreviewUrl(null); // No preview for non-image files like PDF
        }
      } else {
        toast({
          title: t('upload_toast_invalid_file_type_title'),
          description: t('paid_invoices_invalid_receipt_type_desc'),
          variant: 'destructive',
        });
        setSelectedFile(null);
        setPreviewUrl(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    }
  };

  const resetDialog = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleConfirm = async () => {
    if (!selectedFile) {
      toast({
        title: t('error_title'),
        description: t('paid_invoices_error_no_receipt_selected'),
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const originalBase64 = reader.result as string;
        let imageToUpload = originalBase64;
        if (selectedFile.type.startsWith('image/')) {
            imageToUpload = await compressImage(originalBase64);
        }
        await onConfirmUpload(imageToUpload);
        // resetDialog(); // Reset is handled by onOpenChange(false) now
        // onOpenChange(false); // Caller will handle closing
      } catch (error) {
        console.error("Error processing receipt image:", error);
        toast({
          title: t('error_title'),
          description: t('paid_invoices_error_processing_receipt') + `: ${(error as Error).message}`,
          variant: 'destructive',
        });
      } finally {
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
        setIsProcessing(false);
        toast({ title: t('error_title'), description: t('upload_toast_upload_failed_read_desc'), variant: 'destructive' });
    }
    reader.readAsDataURL(selectedFile);
  };

  const handleDialogStateChange = (open: boolean) => {
    if (!open) {
        resetDialog(); // Reset when dialog is closed externally or via X button
    }
    onOpenChange(open);
  };


  return (
    <Dialog open={isOpen} onOpenChange={handleDialogStateChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('paid_invoices_upload_receipt_title', { fileName: invoiceFileName })}</DialogTitle>
          <DialogDescription>{t('paid_invoices_upload_receipt_desc')}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <Label htmlFor="receipt-upload" className="mb-2 block text-sm font-medium">
              {t('paid_invoices_select_receipt_label')}
            </Label>
            <div
              className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-md cursor-pointer hover:border-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="space-y-1 text-center">
                {previewUrl ? (
                  <div className="relative w-full h-40">
                    <NextImage src={previewUrl} alt={t('paid_invoices_receipt_preview_alt')} layout="fill" objectFit="contain" />
                  </div>
                ) : selectedFile && selectedFile.type === 'application/pdf' ? (
                    <div className="py-4 text-sm text-muted-foreground">{t('paid_invoices_pdf_selected')}: {selectedFile.name}</div>
                ) : (
                  <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                )}
                <div className="flex text-sm text-muted-foreground justify-center">
                  <Label
                    htmlFor="receipt-upload"
                    className="relative cursor-pointer rounded-md font-medium text-primary hover:text-primary/80 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-ring"
                  >
                    <span>{selectedFile ? t('paid_invoices_change_receipt_button') : t('paid_invoices_upload_receipt_button')}</span>
                    <Input id="receipt-upload" name="receipt-upload" type="file" className="sr-only" ref={fileInputRef} onChange={handleFileChange} accept="image/*,application/pdf" />
                  </Label>
                  {!selectedFile && <p className="pl-1">{t('paid_invoices_drag_drop_text')}</p>}
                </div>
                {!previewUrl && !selectedFile && <p className="text-xs text-muted-foreground">{t('paid_invoices_file_types_text')}</p>}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
             <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedFile || isProcessing}>
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ImageIconLucide className="mr-2 h-4 w-4" />
            )}
            {t('paid_invoices_confirm_upload_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentReceiptUploadDialog;
