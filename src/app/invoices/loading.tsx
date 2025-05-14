// src/app/invoices/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText as FileTextIcon, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export default function InvoicesLoading() {
  const { t } = useTranslation();

  const renderSkeletonGridCard = (key: number) => (
    <Card key={key} className="animate-pulse">
      <CardHeader className="p-0 relative aspect-[4/3] bg-muted rounded-t-lg" />
      <CardContent className="p-3 space-y-1">
        <Skeleton className="h-4 w-3/4" /> {/* File Name Skeleton */}
        <Skeleton className="h-3 w-1/2" /> {/* Date Skeleton */}
        <Skeleton className="h-3 w-1/4" /> {/* Status Skeleton */}
      </CardContent>
      <CardFooter className="p-3 border-t">
        <Skeleton className="h-7 w-full" /> {/* View Details Button Skeleton */}
      </CardFooter>
    </Card>
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
              <FileTextIcon className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> <Skeleton className="h-7 w-40" /> {/* Page Title */}
            </CardTitle>
          </div>
          <CardDescription><Skeleton className="h-4 w-3/4" /></CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters Skeleton */}
          <div className="mb-4 flex flex-wrap gap-2">
            <Skeleton className="h-10 w-full sm:w-32" /> {/* Doc Type Filter */}
            <Skeleton className="h-10 w-full sm:w-48" /> {/* Search Filter */}
            <Skeleton className="h-10 w-full sm:w-40" /> {/* Date Range Filter */}
            <Skeleton className="h-10 w-full sm:w-32" /> {/* Supplier Filter */}
            <Skeleton className="h-10 w-full sm:w-32" /> {/* Status Filter */}
            <Skeleton className="h-10 w-full sm:w-32" /> {/* View Mode Toggle */}
          </div>

          {/* Tabs Skeleton */}
          <div className="grid w-full grid-cols-2 mb-4 border-b">
            <Skeleton className="h-10 w-full rounded-t-md" />
            <Skeleton className="h-10 w-full rounded-t-md" />
          </div>
          
          {/* Assuming default view is grid for loading state */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, index) => renderSkeletonGridCard(index))}
          </div>

          <div className="flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">{t('invoices_loading')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
