// src/app/accounts/other-expenses/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Loader2, Landmark, Home, Building, Edit2 } from "lucide-react"; 
import { useTranslation } from '@/hooks/useTranslation';

export default function OtherExpensesLoading() {
  const { t } = useTranslation();

  const renderSkeletonFixedExpenseCard = (Icon: React.ElementType) => (
    <Card className="shadow-md flex flex-col">
      <CardHeader className="pb-3 flex flex-row items-start justify-between">
        <div>
            <Skeleton className="h-6 w-2/5 mb-1" /> 
            <Skeleton className="h-4 w-4/5" /> 
        </div>
        <Skeleton className="h-8 w-8 rounded-md" /> 
      </CardHeader>
      <CardContent className="space-y-1 flex-grow">
        <Skeleton className="h-8 w-1/2" /> 
        <Skeleton className="h-3 w-2/3" /> 
      </CardContent>
      <CardFooter className="border-t pt-3 pb-3">
        <Skeleton className="h-9 w-full rounded-md" /> 
      </CardFooter>
    </Card>
  );

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <Skeleton className="h-9 w-36 mb-4" /> 

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {renderSkeletonFixedExpenseCard(Home)} 
        {renderSkeletonFixedExpenseCard(Building)} 
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Landmark className="mr-2 h-5 sm:h-6 w-5 sm:w-6" />
            <Skeleton className="h-7 w-56" /> 
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-lg mt-1" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="flex items-center gap-2 border-b pb-2">
                
                <Skeleton className="h-10 w-24 rounded-md" />
                <Skeleton className="h-10 w-24 rounded-md" />
                <Skeleton className="h-10 w-24 rounded-md" />
                <Skeleton className="h-10 w-10 rounded-full ml-auto" /> 
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card className="shadow-sm">
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/2 mt-1" /></CardHeader>
                    <CardContent className="pt-0 pb-2"><Skeleton className="h-6 w-1/2" /></CardContent>
                    <CardFooter className="border-t pt-3 pb-3 flex justify-end gap-2"><Skeleton className="h-8 w-8"/><Skeleton className="h-8 w-8"/></CardFooter>
                </Card>
                 <Card className="shadow-sm">
                    <CardHeader className="pb-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-1/2 mt-1" /></CardHeader>
                    <CardContent className="pt-0 pb-2"><Skeleton className="h-6 w-1/2" /></CardContent>
                    <CardFooter className="border-t pt-3 pb-3 flex justify-end gap-2"><Skeleton className="h-8 w-8"/><Skeleton className="h-8 w-8"/></CardFooter>
                </Card>
            </div>
            <div className="flex justify-end pt-4 mt-4 border-t">
                 <Skeleton className="h-10 w-36" /> 
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
