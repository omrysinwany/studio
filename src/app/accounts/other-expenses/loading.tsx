// src/app/accounts/other-expenses/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Loader2, Landmark } from "lucide-react";
import { useTranslation } from '@/hooks/useTranslation';

export default function OtherExpensesLoading() {
  const { t } = useTranslation();

  const renderSkeletonCategoryCard = (titleKey: string) => (
    <Card className="shadow-md flex flex-col">
      <CardHeader className="pb-3">
        <Skeleton className="h-6 w-3/5 mb-1" /> {/* Title Skeleton */}
        <Skeleton className="h-4 w-4/5" /> {/* Description Skeleton */}
      </CardHeader>
      <CardContent className="space-y-3 flex-grow">
        <div>
          <Skeleton className="h-4 w-1/4 mb-1" /> {/* Label Skeleton */}
          <Skeleton className="h-10 w-full" /> {/* Input Skeleton */}
        </div>
        <Skeleton className="h-4 w-2/3" /> {/* Last recorded info skeleton */}
      </CardContent>
      <CardFooter className="border-t pt-3 pb-3 flex justify-end gap-2">
        <Skeleton className="h-8 w-8 rounded-md" /> {/* Edit Button Skeleton */}
        <Skeleton className="h-9 w-24 rounded-md" /> {/* Save Button Skeleton */}
      </CardFooter>
    </Card>
  );


  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <Skeleton className="h-9 w-36 mb-4" /> {/* Back button skeleton */}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {renderSkeletonCategoryCard("Property Tax")}
        {renderSkeletonCategoryCard("Rent")}
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Landmark className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> 
            <Skeleton className="h-7 w-56" /> {/* "Other Business Expenses" */}
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-lg mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="flex items-center gap-2">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-10 rounded-full ml-auto" />
            </div>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-12 w-36 ml-auto" />
        </CardContent>
      </Card>
        <div className="flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
        </div>
    </div>
  );
}
