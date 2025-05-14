
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"; // Added CardFooter
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Briefcase, Loader2, Package } from 'lucide-react';
import { useTranslation } from "@/hooks/useTranslation";

export default function InventoryLoading() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('inventory_title')}
          </CardTitle>
          <CardDescription>{t('inventory_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <Skeleton className="h-10 w-full md:max-w-xs lg:max-w-sm" />
            <div className="flex gap-2">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-1/2" /></CardContent>
            </Card>
             <Card>
              <CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-1/2" /></CardContent>
            </Card>
          </div>


          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Skeleton className="h-5 w-12" /></TableHead>{/* Actions */}
                  <TableHead><Skeleton className="h-5 w-12" /></TableHead>{/* Image */}
                  <TableHead><Skeleton className="h-5 w-32" /></TableHead>{/* Product Name */}
                  <TableHead className="text-center"><Skeleton className="h-5 w-20" /></TableHead>{/* Quantity */}
                  <TableHead className="text-right"><Skeleton className="h-5 w-24" /></TableHead>{/* Sale Price */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-10 rounded" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-10" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-5 w-20" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
           <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2 text-muted-foreground">{t('inventory_loading_inventory')}</p>
            </div>
        </CardContent>
         <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-2 p-4 border-t">
            <Skeleton className="h-8 w-48" /> {/* Pagination Skeleton */}
            <div className="flex gap-2">
                <Skeleton className="h-10 w-32" /> {/* Export Skeleton */}
                <Skeleton className="h-10 w-40" /> {/* Delete All Skeleton */}
            </div>
         </CardFooter>
      </Card>
    </div>
  );
}
