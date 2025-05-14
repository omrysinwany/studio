// src/app/settings/notifications/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Bell } from "lucide-react";
import { useTranslation } from '@/hooks/useTranslation';

export default function NotificationSettingsLoading() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <Skeleton className="h-9 w-36 mb-4" /> {/* Back button skeleton */}
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Bell className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />
            <Skeleton className="h-7 w-56" /> {/* "Notification Preferences" */}
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-md mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" /> {/* Label skeleton */}
            <Skeleton className="h-10 w-full max-w-xs" /> {/* Input skeleton */}
            <Skeleton className="h-3 w-3/4" /> {/* Helper text skeleton */}
          </div>
          <div className="flex justify-end pt-2">
            <Skeleton className="h-10 w-32" /> {/* Button skeleton */}
          </div>
        </CardContent>
      </Card>
        <div className="flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
        </div>
    </div>
  );
}
