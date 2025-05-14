// src/app/accounts/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CreditCard, TrendingDown, Landmark, BarChart3, DollarSign, Banknote, TrendingUp, Info } from "lucide-react";
import { useTranslation } from '@/hooks/useTranslation';

export default function AccountsLoading() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      {/* Page Title Skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <CreditCard className="mr-2 h-6 w-6 text-primary" />
          <Skeleton className="h-7 w-32" /> {/* "Accounts" */}
        </div>
        <Skeleton className="h-10 w-48" /> {/* Date Range Picker Skeleton */}
      </div>
      <Skeleton className="h-4 w-3/4 max-w-md" /> {/* Page Description Skeleton */}

      {/* This Month's Expenses Card Skeleton */}
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <Banknote className="mr-2 h-5 w-5 text-red-500" /> 
            <Skeleton className="h-6 w-48" /> {/* "This Month's Expenses" */}
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-xs mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-36 mb-2" /> {/* Currency Value Skeleton */}
          <Skeleton className="h-4 w-32 mb-1" /> {/* Budget label skeleton */}
          <Skeleton className="h-2 w-full max-w-sm" /> {/* Progress bar skeleton */}
        </CardContent>
      </Card>

      {/* Key Financial Summaries Card Skeleton */}
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <DollarSign className="mr-2 h-5 w-5" />
            <Skeleton className="h-6 w-56" /> {/* "Key Financial Summaries" */}
          </CardTitle>
           <CardDescription>
            <Skeleton className="h-4 w-full max-w-sm mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
            </div>
        </CardContent>
      </Card>


      {/* Open Invoices Card Skeleton */}
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary flex items-center">
            <Skeleton className="mr-2 h-5 w-5 rounded-full" /> {/* Icon Skeleton */}
            <Skeleton className="h-6 w-40" /> {/* "Open Invoices" */}
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-sm mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" /> {/* Table/List Skeleton */}
        </CardContent>
      </Card>

      {/* Other Business Expenses Link Card Skeleton */}
      <Card className="shadow-md">
        <CardHeader>
            <div className="flex justify-between items-center">
                <CardTitle className="text-xl font-semibold text-primary flex items-center">
                    <Landmark className="mr-2 h-5 w-5" /> 
                    <Skeleton className="h-6 w-56" /> {/* "Other Business Expenses" */}
                </CardTitle>
                 <Skeleton className="h-5 w-5 rounded-full" /> {/* Arrow Icon Skeleton */}
            </div>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-md mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-32" /> {/* Currency Value Skeleton */}
          <Skeleton className="h-3 w-48 mt-1" /> {/* Small text skeleton */}
        </CardContent>
      </Card>

      {/* Top Expense Categories Card Skeleton */}
      <Card className="shadow-md">
        <CardHeader>
            <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <BarChart3 className="mr-2 h-5 w-5" />
                <Skeleton className="h-6 w-64" /> {/* "Top Expense Categories" */}
            </CardTitle>
            <CardDescription>
                <Skeleton className="h-4 w-full max-w-lg mt-1" />
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>

      {/* Profitability & Future Outlook Card Skeleton */}
       <Card className="shadow-md">
          <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center">
                <Info className="mr-2 h-5 w-5" /> 
                <Skeleton className="h-6 w-64" /> {/* "Profitability & Future Outlook" */}
              </CardTitle>
              <CardDescription>
                <Skeleton className="h-4 w-full max-w-lg mt-1" />
              </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div>
                <Skeleton className="h-5 w-40 mb-1" /> {/* Subtitle Skeleton */}
                <Skeleton className="h-4 w-32" /> {/* "Coming soon" Skeleton */}
              </div>
              <Skeleton className="h-px w-full" /> {/* Separator Skeleton */}
              <div>
                <Skeleton className="h-5 w-48 mb-1" /> {/* Subtitle Skeleton */}
                <Skeleton className="h-4 w-32" /> {/* "Coming soon" Skeleton */}
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
