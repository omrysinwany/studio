
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto p-4 md:p-8 flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))]">
      <Alert variant="destructive" className="max-w-lg text-center">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
        <AlertTitle className="text-xl font-semibold">Something went wrong!</AlertTitle>
        <AlertDescription className="mt-2 mb-4">
          {error.message || "An unexpected error occurred while loading the reports."}
        </AlertDescription>
        <Button
          onClick={
            // Attempt to recover by trying to re-render the segment
            () => reset()
          }
        >
          Try again
        </Button>
      </Alert>
    </div>
  );
}
