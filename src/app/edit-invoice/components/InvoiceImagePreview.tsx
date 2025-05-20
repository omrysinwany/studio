import React from 'react';
import NextImage from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Image as ImageIconLucide, FileText as FileTextIconLucide } from 'lucide-react'; // Assuming Image is ImageIconLucide

interface InvoiceImagePreviewProps {
  displayedOriginalImageUrl: string | null;
  displayedCompressedImageUrl: string | null;
  t: (key: string) => string;
}
const isValidImageSrc = (src: string | undefined | null): src is string => {
    if (!src || typeof src !== 'string') return false;
    return src.startsWith('data:image') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('blob:');
};

export function InvoiceImagePreview({
  displayedOriginalImageUrl,
  displayedCompressedImageUrl,
  t
}: InvoiceImagePreviewProps) {
  const imageUrl = displayedOriginalImageUrl || displayedCompressedImageUrl;

  return (
    <Card className="shadow-sm">
      <CardHeader className="p-3 sm:p-4">
        <CardTitle className="text-base sm:text-lg flex items-center">
          <ImageIconLucide className="mr-2 h-5 w-5 text-primary"/>
          {t('edit_invoice_image_preview_label')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 flex justify-center items-center">
        {isValidImageSrc(imageUrl) ? (
          <div className="relative aspect-auto w-full max-h-[300px] sm:max-h-[400px] border rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
            <NextImage
              src={imageUrl}
              alt={t('edit_invoice_image_preview_alt')}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              style={{objectFit:"contain"}}
            />
          </div>
        ) : (
          <div className="aspect-auto w-full h-[200px] sm:h-[300px] border rounded-md bg-muted flex items-center justify-center text-muted-foreground">
            <FileTextIconLucide className="h-16 w-16 opacity-50"/>
          </div>
        )}
      </CardContent>
    </Card>
  );
}