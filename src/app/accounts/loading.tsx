'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CreditCard } from "lucide-react";
import { useTranslation } from '@/hooks/useTranslation';

export default function AccountsLoading() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <CreditCard className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> 
            <Skeleton className="h-7 w-32" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-md mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent>
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
        <div className="flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
        </div>
    </div>
  );
}
