
'use client';

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { Package, FileText, BarChart2, ScanLine, Loader2, AlertTriangle, TrendingUp, TrendingDown, Info, DollarSign } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProductsService, InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import { calculateInventoryValue, calculateTotalItems, getLowStockItems } from '@/lib/kpi-calculations';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface KpiData {
  totalItems: number;
  inventoryValue: number;
  docsProcessedLast30Days: number;
  lowStockItemsCount: number;
  latestDocName?: string;
  inventoryValueTrend?: { name: string; value: number }[];
  inventoryValuePrevious?: number;
}

// SparkLine Chart Component
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
          labelFormatter={() => ''} // Hide label (date) in tooltip for sparkline
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

  const formatLargeNumber = (num: number | undefined, decimals = 1): string => {
    if (num === undefined || num === null || isNaN(num)) {
      return '-';
    }
    if (Math.abs(num) < 1000) {
        return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
    const formattedNum = (num / si[i].value).toFixed(decimals).replace(rx, "$1");
    return formattedNum + si[i].symbol;
  };
  
  const renderKpiValue = (value: number | undefined, isCurrency: boolean = false, isInteger: boolean = false) => {
    if (isLoadingKpis) {
      return <Loader2 className="h-6 w-6 animate-spin text-primary" />;
    }
    if (kpiError) return <span className="text-destructive text-lg">-</span>;
    if (value === undefined || value === null || isNaN(value)) return '-';
    
    const prefix = isCurrency ? '₪' : '';
    
    if ((isCurrency && Math.abs(value) < 10000) || (isInteger && Math.abs(value) < 1000)) {
         return prefix + value.toLocaleString(undefined, { 
            minimumFractionDigits: isInteger ? 0 : (isCurrency ? 2 : 0),
            maximumFractionDigits: isInteger ? 0 : (isCurrency ? 2 : 0) 
        });
    }
     if (!isInteger && Math.abs(value) >= 1000) { 
        return prefix + formatLargeNumber(value, 0); 
    }
    if (isCurrency && Math.abs(value) >= 10000) { 
        return prefix + formatLargeNumber(value, 2); 
    }

    const options: Intl.NumberFormatOptions = {
      minimumFractionDigits: isInteger ? 0 : (isCurrency ? 2 : 0), 
      maximumFractionDigits: isInteger ? 0 : (isCurrency ? 2 : 1), 
    };
    return prefix + value.toLocaleString(undefined, options);
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
    <TooltipProvider>
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-var(--header-height,4rem))] p-4 sm:p-6 md:p-8 home-background">
      <div className="w-full max-w-4xl text-center">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 text-primary scale-fade-in">
          Welcome to InvoTrack
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground mb-6 md:mb-8 scale-fade-in" style={{ animationDelay: '0.1s' }}>
          {user ? `Hello, ${user.username}! Manage your inventory efficiently.` : 'Streamlining your inventory management.'}
        </p>
        
        <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 mb-8 md:mb-12 scale-fade-in" style={{ animationDelay: '0.2s' }}>
          <Button
            size="lg"
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-105 text-base"
            onClick={handleScanClick}
          >
            <ScanLine className="mr-2 h-5 w-5" /> Scan New Document
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto border-primary text-primary hover:bg-primary/10 shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-105 text-base"
             onClick={handleInventoryClick}
          >
            <Package className="mr-2 h-5 w-5" /> View Inventory
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-md hover:shadow-lg transition-all duration-300 ease-in-out hover:scale-105 text-base"
             onClick={handleReportsClick}
          >
            <BarChart2 className="mr-2 h-5 w-5" /> View Reports
          </Button>
        </div>


        {kpiError && !isLoadingKpis && (
          <Alert variant="destructive" className="mb-6 md:mb-8 text-left scale-fade-in delay-400">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{kpiError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 scale-fade-in" style={{ animationDelay: '0.3s' }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/inventory" className="block hover:no-underline">
                  <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
                      <Package className="h-5 w-5 text-accent" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.totalItems, false, true)}</div>
                      <p className="text-xs text-muted-foreground pt-1">Currently in stock</p>
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
                    <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Inventory Value</CardTitle>
                        <DollarSign className="h-5 w-5 text-accent" />
                        </CardHeader>
                        <CardContent className="pt-1">
                        <div className="text-2xl sm:text-3xl font-bold text-primary flex items-center">
                            {renderKpiValue(kpiData?.inventoryValue, true)}
                            {kpiData && kpiData.inventoryValueTrend && kpiData.inventoryValueTrend.length > 1 && kpiData.inventoryValuePrevious !== undefined && (
                                kpiData.inventoryValue > kpiData.inventoryValuePrevious ?
                                <TrendingUp className="h-5 w-5 text-green-500 ml-2" /> :
                                kpiData.inventoryValue < kpiData.inventoryValuePrevious ?
                                <TrendingDown className="h-5 w-5 text-red-500 ml-2" /> : null
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
                    <p>Total monetary value of your current inventory.</p>
                    {kpiData?.inventoryValuePrevious !== undefined && kpiData.inventoryValue !== kpiData.inventoryValuePrevious && (
                         <p className={cn("text-xs", kpiData.inventoryValue > kpiData.inventoryValuePrevious ? "text-green-500" : "text-red-500")}>
                             Previous: ₪{kpiData.inventoryValuePrevious.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
                         </p>
                    )}
                </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/invoices" className="block hover:no-underline">
                  <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Docs (30d)</CardTitle>
                      <FileText className="h-5 w-5 text-accent" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.docsProcessedLast30Days, false, true)}</div>
                      <p className="text-xs text-muted-foreground pt-1 truncate" title={kpiData?.latestDocName || 'Latest document processed'}>
                        Last: {renderKpiText(kpiData?.latestDocName)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>Number of documents processed in the last 30 days.</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Link href="/inventory?filter=low" className="block hover:no-underline">
                        <Card className="shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out hover:scale-105 h-full text-left bg-card/80 backdrop-blur-sm border-border/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock</CardTitle>
                            <AlertTriangle className="h-5 w-5 text-yellow-500 dark:text-yellow-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl sm:text-3xl font-bold text-primary">{renderKpiValue(kpiData?.lowStockItemsCount, false, true)}</div>
                             <p className="text-xs text-muted-foreground pt-1">Items needing attention</p>
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
                    <p>Number of items at or below their minimum stock level.</p>
                    {kpiData && kpiData.totalItems > 0 && kpiData.lowStockItemsCount >= 0 && (
                        <p className="text-xs">
                            {((kpiData.lowStockItemsCount / kpiData.totalItems) * 100).toFixed(1)}% of total items are low on stock.
                        </p>
                    )}
                </TooltipContent>
            </Tooltip>
         </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
