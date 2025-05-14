
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Package } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

export default function ProductDetailLoading() {
  const { t } = useTranslation();
  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <Skeleton className="h-9 w-24" /> {/* Back button */}
        <div className="flex gap-2">
            <Skeleton className="h-9 w-24" /> {/* Action button 1 */}
            <Skeleton className="h-9 w-24" /> {/* Action button 2 */}
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <Skeleton className="h-8 w-3/5 mb-2" /> {/* Product Name */}
          <Skeleton className="h-4 w-2/5" /> {/* Catalog Number */}
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-48 w-full rounded" /> {/* Image Placeholder */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-4 w-1/3" /> {/* Label */}
                <Skeleton className="h-5 w-2/3" /> {/* Value */}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
       <div className="flex justify-center items-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-2 text-muted-foreground">{t('product_detail_loading_text')}</p>
        </div>
    </div>
  );
}
