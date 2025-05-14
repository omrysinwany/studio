
// src/app/reports/loading.tsx
'use client';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Package, DollarSign, TrendingUp, Repeat, ShoppingCart, FileTextIcon, HandCoins, BarChart3, Banknote, AlertTriangle, Info, Briefcase, ListChecks, FileWarning } from "lucide-react";
import { useTranslation } from '@/hooks/useTranslation';

export default function ReportsLoading() {
  const { t } = useTranslation();

  const renderKpiSkeleton = (Icon?: React.ElementType, lines = 1, isMainKpi = false, colSpan = "xl:col-span-1") => (
    <Card className={colSpan}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-1.5 pt-2.5 px-3">
        <Skeleton className="h-3 w-2/3 sm:h-4" /> {/* Title Skeleton */}
        {Icon && <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent className="pb-2 sm:pb-3 px-3">
        <Skeleton className="h-6 w-1/2 sm:h-7 mb-1" /> {/* Value Skeleton */}
        {Array.from({ length: lines -1 < 0 ? 0 : lines - 1 }).map((_, i) => (
            <Skeleton key={i} className="h-2.5 w-3/4 sm:h-3 mt-1" />
        ))}
      </CardContent>
    </Card>
  );

  const renderChartCardSkeleton = (titleKey: string, chartHeight = "h-[220px]") => (
    <Card className="w-full overflow-hidden">
      <CardHeader className="pb-2 sm:pb-4">
        <Skeleton className="h-6 w-1/2" />
         <Skeleton className="h-4 w-3/4 mt-1" />
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        <div className={`flex items-center justify-center ${chartHeight} w-full bg-muted/50`}>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </CardContent>
    </Card>
  );

  const renderTableCardSkeleton = (titleKey: string, rows = 3, cols = 3, colSpan = "lg:col-span-1") => (
    <Card className={`w-full overflow-hidden ${colSpan}`}>
      <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-8 w-24" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
            <table className="min-w-full">
                <thead>
                    <tr>
                        {Array.from({length: cols}).map((_, i) => <th key={i} className="p-2"><Skeleton className="h-4 w-20"/></th>)}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({length: rows}).map((_, i) => (
                        <tr key={i}>
                            {Array.from({length: cols}).map((_, j) => <td key={j} className="p-2"><Skeleton className="h-4 w-full"/></td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </CardContent>
    </Card>
  );


  return (
    <div className="container mx-auto p-2 sm:p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-full md:w-[260px]" />
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-9 w-24"/>)}
      </div>

      {/* Main KPIs Grid Skeleton */}
      <div className="grid gap-2 sm:gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 mb-6">
        {renderKpiSkeleton(DollarSign, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(Package, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(AlertTriangle, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(HandCoins, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(FileTextIcon, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(Briefcase, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(Banknote, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(ListChecks, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(DollarSign, 1, false, "xl:col-span-1")}
        {renderKpiSkeleton(FileWarning, 1, false, "lg:col-span-2 xl:col-span-2")}
        {renderKpiSkeleton(Banknote, 1, false, "lg:col-span-2 xl:col-span-1")}
      </div>

      {renderTableCardSkeleton("reports_profitability_title", 3, 6, "md:col-span-full")}

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        {renderChartCardSkeleton("reports_chart_value_over_time_title")}
        {renderChartCardSkeleton("reports_chart_docs_processed_title")}
      </div>

      <Card className="w-full overflow-hidden scale-fade-in md:col-span-1 lg:col-span-2">
            <CardHeader className="pb-2 sm:pb-4 flex flex-row items-center justify-between">
                <Skeleton className="h-6 w-1/3"/>
                <Skeleton className="h-8 w-24"/>
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center p-4">
                    <div className="md:col-span-1 max-h-[280px] overflow-y-auto">
                        <table className="w-full">
                            <thead><tr><th className="p-1"><Skeleton className="h-4 w-20"/></th><th className="p-1"><Skeleton className="h-4 w-20"/></th></tr></thead>
                            <tbody>
                                {Array.from({length: 3}).map((_, i) => <tr key={i}><td className="p-1"><Skeleton className="h-4 w-full"/></td><td className="p-1"><Skeleton className="h-4 w-full"/></td></tr>)}
                            </tbody>
                        </table>
                    </div>
                    <div className="md:col-span-1 flex items-center justify-center h-[180px] sm:h-[220px] bg-muted/30 rounded-md">
                         <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                </div>
            </CardContent>
      </Card>

      {renderTableCardSkeleton("reports_table_top_selling_title", 5, 3, "md:col-span-full lg:col-span-1")}

       <Card className="md:col-span-full lg:col-span-1 w-full overflow-hidden scale-fade-in">
            <CardHeader className="pb-2 sm:pb-4 flex flex-col">
                 <Skeleton className="h-6 w-1/2"/>
                 <Skeleton className="h-4 w-3/4 mt-1" />
            </CardHeader>
            <CardContent className="space-y-2 p-4">
                <Skeleton className="h-5 w-3/4"/>
                <Skeleton className="h-5 w-2/3"/>
                <Skeleton className="h-5 w-3/5"/>
                <hr className="my-1"/>
                <Skeleton className="h-6 w-4/5"/>
            </CardContent>
       </Card>

       {renderTableCardSkeleton("reports_supplier_liabilities_title", 3, 3, "md:col-span-full lg:col-span-1")}
       {renderTableCardSkeleton("reports_table_stock_alert_title", 4, 6, "md:col-span-full lg:col-span-2")}


      <div className="flex justify-center items-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
      </div>
    </div>
  );
}


    