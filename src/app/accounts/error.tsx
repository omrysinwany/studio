// src/app/accounts/error.tsx
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from '@/hooks/useTranslation';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))]">
      <Alert variant="destructive" className="max-w-lg text-center">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
        <AlertTitle className="text-xl font-semibold">{t('error_title')}</AlertTitle>
        <AlertDescription className="mt-2 mb-4">
          {error.message || t('barcode_scanner_alert_desc_unexpected_error')}
        </AlertDescription>
        <div className="flex gap-2 justify-center">
            <Button onClick={() => reset()}>
              {t('edit_invoice_try_again')}
            </Button>
            <Button variant="outline" asChild>
                <Link href="/">{t('nav_home')}</Link>
            </Button>
        </div>
      </Alert>
    </div>
  );
}
