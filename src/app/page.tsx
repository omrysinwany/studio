
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText, BarChart2, ScanLine, Loader2, AlertTriangle, TrendingUp, TrendingDown, Info, DollarSign, Palette, Sun, Moon, Settings as SettingsIcon, HandCoins } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import { calculateInventoryValue, calculateTotalItems, getLowStockItems, calculateTotalPotentialGrossProfit } from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "next-themes";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from '@/hooks/useTranslation';


interface KpiData {
  totalItems: number;
  inventoryValue: number;
  docsProcessedLast30Days: number;
  lowStockItemsCount: number;
  latestDocName?: string;
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
  grossProfit: number;
}

const SparkLineChart = ({ data, dataKey, strokeColor }: { data: any[], dataKey: string, strokeColor: string }) => {
  if (!data || data.length === 0) {
    return <div className="h-10 w-full bg-muted/50 rounded-md flex items-center justify-center text-xs text-muted-foreground">No trend data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data}>
        <RechartsTooltip
          contentStyle={{
            background: "hsl(var(--background))",
            borderColor: "hsl(var(--border))",
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            padding: "0.25rem 0.5rem",
          }}
          formatter={(value: number, name: string) => {
             if (name === 'value') return [`₪${value.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits: 0})}`, "Value"];
             return [value.toLocaleString(), name];
          }}
          labelFormatter={() => ''}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={strokeColor}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};


export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [kpiData, setKpiData] = useState<KpiData | null>(null);
  const [isLoadingKpis, setIsLoadingKpis] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchKpiData() {
      if (authLoading) return;

      setIsLoadingKpis(true);
      setKpiError(null);
      try {
        const [products, invoices] = await Promise.all([
          getProductsService(),
          getInvoicesService()
        ]);

        const totalItems = calculateTotalItems(products);
        const inventoryValue = calculateInventoryValue(products);
        const lowStockItemsCount = getLowStockItems(products).length;
        const grossProfit = calculateTotalPotentialGrossProfit(products);

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentInvoices = invoices.filter(
          (invoice) => new Date(invoice.uploadTime).getTime() >= thirtyDaysAgo.getTime()
        );
        const docsProcessedLast30Days = recentInvoices.length;

        const latestDoc = invoices.length > 0
          ? invoices.sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime())[0]
          : null;

        const mockInventoryValueTrend = [
          { name: 'Day 1', value: inventoryValue * 0.95 + Math.random() * 1000 - 500 },
          { name: 'Day 2', value: inventoryValue * 0.98 + Math.random() * 1000 - 500 },
          { name: 'Day 3', value: inventoryValue * 0.96 + Math.random() * 1000 - 500 },
          { name: 'Day 4', value: inventoryValue * 1.02 + Math.random() * 1000 - 500 },
          { name: 'Day 5', value: inventoryValue + Math.random() * 1000 - 500 },
        ].map(d => ({...d, value: Math.max(0, d.value)}));

        setKpiData({
          totalItems,
          inventoryValue,
          docsProcessedLast30Days,
          lowStockItemsCount,
          latestDocName: latestDoc?.fileName.length > 15 ? `${latestDoc.fileName.substring(0,12)}...` : latestDoc?.fileName,
          inventoryValueTrend: mockInventoryValueTrend,
          inventoryValuePrevious: mockInventoryValueTrend.length > 1 ? mockInventoryValueTrend[mockInventoryValueTrend.length - 2].value : inventoryValue,
          grossProfit,
        });

      } catch (error) {
        console.error("Failed to fetch KPI data:", error);
        setKpiError("Could not load dashboard data. Please try again later.");
        toast({
          title: "Error Loading Dashboard",
          description: "Failed to fetch key performance indicators.",
          variant: "destructive",
        });
      } finally {
        setIsLoadingKpis(false);
      }
    }

    fetchKpiData();
  }, [authLoading, toast]);


  const handleScanClick = () => {
    router.push('/upload');
  };

  const handleInventoryClick = () => {
    router.push('/inventory');
  };

  const handleReportsClick = () => {
    router.push('/reports');
  };

  const formatLargeNumber = (num: number | undefined, decimals = 1, isCurrency = false): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return isCurrency ? '₪-' : '-';
    }

    const prefix = isCurrency ? '₪' : '';

    if (Math.abs(num) < 1000) {
        return prefix + num.toLocaleString(undefined, {
            minimumFractionDigits: isCurrency ? 2 : 0,
            maximumFractionDigits: isCurrency ? 2 : 0
        });
    }

    const si = [
        { value: 1, symbol: "" },
        { value: 1E3, symbol: "K" },
        { value: 1E6, symbol: "M" },
        { value: 1E9, symbol: "B" },
        { value: 1E12, symbol: "T" }
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    let i;
    for (i = si.length - 1; i > 0; i--) {
        if (Math.abs(num) >= si[i].value) {
            break;
        }
    }

    let numDecimals = isCurrency ? ( (num / si[i].value) % 1 === 0 ? 0 : 2) : decimals;
    if (si[i].value === 1) numDecimals = isCurrency ? 2 : 0;

    const formattedNum = (num / si[i].value).toFixed(numDecimals).replace(rx, "$1");
    return prefix + formattedNum + si[i].symbol;
  };

  const renderKpiValue = (value: number | undefined, isCurrency: boolean = false, isInteger: boolean = false) => {
    if (isLoadingKpis) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError) return <span className="text-destructive text-lg">-</span>;
    if (value === undefined || value === null || isNaN(value)) return isCurrency ? '₪-' : '-';

    return formatLargeNumber(value, isInteger ? 0 : (isCurrency ? 2 : 1), isCurrency);
  };

  const renderKpiText = (text: string | undefined) => {
    if (isLoadingKpis) {
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    }
    if (kpiError) return <span className="text-destructive text-xs">-</span>;
    return text || '-';
  };

   if (authLoading && !kpiData) {
     return (
       <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 md:p-8">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="mt-4 text-muted-foreground">Loading...</p>
       </div>
     );
   }

  return (
    <div className="flex flex-col items-center justify-start min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8 home-background">
      <TooltipProvider>
        <div className="w-full max-w-4xl text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-2 text-primary scale-fade-in">
            {t('welcome_message')}
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground mb-6 md:mb-8 scale-fade-in" style={{ animationDelay: '0.1s' }}>
            {user ? t('greeting_user', { username: user.username }) : t('greeting_guest')}
          </p>

           <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8 md:mb-12 scale-fade-in" style={{ animationDelay: '0.2s' }}>
            <Button
              size="lg"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleScanClick}
            >
              <ScanLine className="mr-2 h-5 w-5" /> {t('scan_document')}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full border-primary text-primary hover:bg-primary/10 shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleInventoryClick}
            >
              <Package className="mr-2 h-5 w-5" /> {t('view_inventory')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="w-full bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 text-base transform hover:-translate-y-1 py-6 sm:py-7"
              onClick={handleReportsClick}
            >
              <BarChart2 className="mr-2 h-5 w-5" /> {t('view_reports')}
            </Button>
          </div>

          {kpiError && !isLoadingKpis && (
            <Alert variant="destructive" className="mb-6 md:mb-8 text-left scale-fade-in delay-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{kpiError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 scale-fade-in" style={{ animationDelay: '0.3s' }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/inventory" className="block hover:no-underline">
                    <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50 transform hover:-translate-y-1">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('kpi_total_items')}</CardTitle>
                        <Package className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.totalItems, false, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">{t('kpi_total_items_desc')}</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Total number of individual items in your inventory.</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                  <TooltipTrigger asChild>
                      <Link href="/reports" className="block hover:no-underline">
                      <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50 transform hover:-translate-y-1">
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-4 px-4">
                          <CardTitle className="text-sm font-medium text-muted-foreground">{t('kpi_inventory_value')}</CardTitle>
                          <DollarSign className="h-5 w-5 text-accent" />
                          </CardHeader>
                          <CardContent className="pt-1 pb-2 px-4">
                            <div className="text-2xl sm:text-3xl font-bold text-primary flex items-baseline">
                                {renderKpiValue(kpiData?.inventoryValue, true)}
                                {kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                                    kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                    <TrendingUp className="h-4 w-4 text-green-500 ml-1.5 shrink-0" /> :
                                    <TrendingDown className="h-4 w-4 text-red-500 ml-1.5 shrink-0" />
                                )}
                            </div>
                            <div className="mt-1">
                                <SparkLineChart data={kpiData?.inventoryValueTrend || []} dataKey="value" strokeColor="hsl(var(--accent))" />
                            </div>
                          </CardContent>
                      </Card>
                      </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>{t('kpi_inventory_value_tooltip')}</p>
                      {kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                          <p className={cn("text-xs", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-500" : "text-red-500")}>
                              {t('kpi_inventory_value_desc_vs', { previousValue: formatLargeNumber(kpiData.inventoryValuePrevious, 2, true)})}
                          </p>
                      )}
                  </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/reports" className="block hover:no-underline">
                    <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50 transform hover:-translate-y-1">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('kpi_gross_profit')}</CardTitle>
                        <HandCoins className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.grossProfit, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1">{t('kpi_gross_profit_desc')}</p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('kpi_gross_profit_tooltip')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/invoices" className="block hover:no-underline">
                    <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50 transform hover:-translate-y-1">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t('kpi_docs_30d')}</CardTitle>
                        <FileText className="h-5 w-5 text-accent" />
                      </CardHeader>
                      <CardContent className="pb-4 px-4">
                        <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.docsProcessedLast30Days, false, true)}</div>
                        <p className="text-xs text-muted-foreground pt-1 truncate" title={kpiData?.latestDocName || 'Latest document processed'}>
                          {t('kpi_docs_30d_last', { latestDocName: renderKpiText(kpiData?.latestDocName) })}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('kpi_docs_30d_tooltip')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                  <TooltipTrigger asChild>
                      <Link href="/inventory?filter=low" className="block hover:no-underline">
                          <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50 transform hover:-translate-y-1">
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
                              <CardTitle className="text-sm font-medium text-muted-foreground">{t('kpi_low_stock')}</CardTitle>
                              <AlertTriangle className="h-5 w-5 text-yellow-500 dark:text-yellow-400" />
                          </CardHeader>
                          <CardContent className="pb-4 px-4">
                              <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.lowStockItemsCount, false, true)}</div>
                              <p className="text-xs text-muted-foreground pt-1">{t('kpi_low_stock_desc')}</p>
                              {kpiData && kpiData.totalItems > 0 && kpiData.lowStockItemsCount >= 0 && (
                                  <Progress
                                      value={(kpiData.lowStockItemsCount / kpiData.totalItems) * 100}
                                      className="h-2 mt-2 bg-muted/50"
                                      indicatorClassName={cn(
                                          "transition-all duration-500 ease-out",
                                          (kpiData.lowStockItemsCount / kpiData.totalItems) * 100 > 50 ? "bg-destructive" :
                                          (kpiData.lowStockItemsCount / kpiData.totalItems) * 100 > 20 ? "bg-yellow-500" :
                                          "bg-accent"
                                      )}
                                  />
                              )}
                          </CardContent>
                          </Card>
                      </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                      <p>{t('kpi_low_stock_tooltip')}</p>
                      {kpiData && kpiData.totalItems > 0 && kpiData.lowStockItemsCount >= 0 && (
                          <p className="text-xs">
                              {t('kpi_low_stock_percentage_desc', {percentage: ((kpiData.lowStockItemsCount / kpiData.totalItems) * 100).toFixed(1)})}
                          </p>
                      )}
                  </TooltipContent>
              </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
