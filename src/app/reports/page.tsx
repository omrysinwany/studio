
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, Repeat, ShoppingCart, FileTextIcon, HandCoins } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend, PieChart as RechartsPieChart } from 'recharts';
import { Button } from '@/components/ui/button';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, subMonths } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getProductsService, Product, InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import {
    calculateInventoryValue,
    calculateTotalItems,
    getLowStockItems,
    calculateGrossProfitMargin,
    calculateInventoryTurnoverRate,
    calculateAverageOrderValue,
    calculateTotalPotentialGrossProfit
} from '@/lib/kpi-calculations';
import { useTranslation } from '@/hooks/useTranslation';

const formatNumber = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 2, useGrouping = true, currency = false } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
        return currency ? `${t('currency_symbol')}${zeroFormatted}` : zeroFormatted;
    }

    const formatted = value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
    return currency ? `${t('currency_symbol')}${formatted}` : formatted;
};


const chartConfig = {
  value: { labelKey: 'reports_chart_label_value', color: 'hsl(var(--chart-1))' },
  count: { labelKey: 'reports_chart_label_count', color: 'hsl(var(--chart-2))' },
  sales: { labelKey: 'reports_chart_label_sales', color: 'hsl(var(--chart-3))' },
  quantitySold: { labelKey: 'reports_chart_label_qty_sold', color: 'hsl(var(--chart-4))'},
  documents: { labelKey: 'reports_chart_label_documents', color: 'hsl(var(--chart-5))' }
} satisfies Omit<React.ComponentProps<typeof ChartContainer>["config"], string>;


const PIE_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

interface StockAlert {
  id: string;
  name: string;
  catalogNumber: string;
  quantity: number;
  status: 'Low Stock' | 'Out of Stock' | 'Over Stock';
  minStock?: number;
  maxStock?: number;
  isDefaultMinStock?: boolean;
}


export default function ReportsPage() {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState<any | null>(null);
  const [valueOverTime, setValueOverTime] = useState<any[]>([]);
  const [categoryDistribution, setCategoryDistribution] = useState<any[]>([]);
  const [processingVolume, setProcessingVolume] = useState<any[]>([]);
  const [salesByCategory, setSalesByCategory] = useState<any[]>([]);
  const [topSellingProducts, setTopSellingProducts] = useState<any[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);

  const [inventory, setInventory] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subMonths(new Date(), 1),
    to: new Date(),
  });
  const { toast } = useToast();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);


    useEffect(() => {
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                const [inventoryData, invoicesData] = await Promise.all([
                    getProductsService(),
                    getInvoicesService()
                ]);
                setInventory(inventoryData);
                setInvoices(invoicesData);
            } catch (error) {
                console.error("Failed to fetch initial data:", error);
                toast({
                    title: t('reports_toast_error_fetch_title'),
                    description: t('reports_toast_error_fetch_desc'),
                    variant: "destructive",
                });
                setInventory([]);
                setInvoices([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialData();
    }, [toast, t]);

   useEffect(() => {
     const generateReports = () => {
       if (isLoading || inventory.length === 0) return;

       const filteredInvoices = invoices.filter(invoice => {
         const invoiceDate = new Date(invoice.uploadTime);
         if (dateRange?.from && invoiceDate < dateRange.from) return false;
         if (dateRange?.to && invoiceDate > dateRange.to) return false;
         return true;
       });


       const totalValue = calculateInventoryValue(inventory);
       const totalItemsCount = calculateTotalItems(inventory);
       const lowStockItemsCount = getLowStockItems(inventory).length;
       const totalPotentialGrossProfit = calculateTotalPotentialGrossProfit(inventory);


       const mockTotalRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0) * 1.5;
       const mockCogs = mockTotalRevenue * 0.65;
       const grossProfitMargin = calculateGrossProfitMargin(mockTotalRevenue, mockCogs);
       const inventoryTurnoverRate = calculateInventoryTurnoverRate(mockCogs, totalValue > 0 ? totalValue / 2 : 1);
       const averageOrderValue = calculateAverageOrderValue(filteredInvoices);

       setKpis({
         totalValue,
         totalItems: totalItemsCount,
         lowStockItems: lowStockItemsCount,
         grossProfitMargin,
         inventoryTurnoverRate,
         averageOrderValue,
         totalPotentialGrossProfit,
         valueChangePercent: Math.random() * 10 - 5,
       });

       const votData = [];
       let currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const endDate = dateRange?.to || new Date();
       const numPoints = isMobile ? 5 : 10;
       const step = Math.max(1, Math.floor((endDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * numPoints)));

       while (currentDate <= endDate) {
           const monthStr = format(currentDate, "MMM dd");
           const invoicesUpToDate = invoices.filter(inv => new Date(inv.uploadTime) <= currentDate);
           const simulatedValue = invoicesUpToDate.reduce((sum, inv) => sum + (inv.totalAmount || 0),0) * (0.8 + Math.random() * 0.4);
           votData.push({
               date: monthStr,
               value: simulatedValue,
           });
           currentDate.setDate(currentDate.getDate() + step);
       }
       setValueOverTime(votData);


       const categories = ['Electronics', 'Clothing', 'Home Goods', 'Books', 'Other'];
        const catDistData = categories.map(cat => {
            const categoryProducts = inventory.filter(p => (p.description.toLowerCase().includes(cat.slice(0,4).toLowerCase())) || (cat === 'Other' && !categories.slice(0,-1).some(c => p.description.toLowerCase().includes(c.slice(0,4).toLowerCase()))));
            return {
                name: cat,
                value: calculateInventoryValue(categoryProducts)
            };
        }).filter(c => c.value > 0);
       setCategoryDistribution(catDistData);

       const procVolData = [];
       currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const procVolNumPoints = isMobile ? 3 : 5;
       const procVolStep = Math.max(1, Math.floor((endDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * 30 * procVolNumPoints)));

        while (currentDate <= endDate) {
           const monthStr = format(currentDate, "MMM yy");
           const count = filteredInvoices.filter(inv => format(new Date(inv.uploadTime), "MMM yy") === monthStr).length;
           if(!procVolData.find(d => d.period === monthStr)) {
             procVolData.push({ period: monthStr, documents: count });
           }
           currentDate.setMonth(currentDate.getMonth() + procVolStep);
       }
       setProcessingVolume(procVolData);

       const mockSalesByCategoryData = categories.map(cat => ({ category: cat, sales: Math.floor(Math.random() * 10000) + 2000 }));
       setSalesByCategory(mockSalesByCategoryData);


        const topProducts = inventory
            .map(p => ({
                id: p.id,
                name: p.shortName || p.description.slice(0,25) + (p.description.length > 25 ? '...' : ''),
                quantitySold: Math.floor(Math.random() * (p.quantity > 0 ? p.quantity : 10)) + 1,
                totalValue: (p.salePrice || p.unitPrice || 0) * (Math.floor(Math.random() * (p.quantity > 0 ? p.quantity : 10)) + 1)
            }))
            .sort((a,b) => b.totalValue - a.totalValue)
            .slice(0, 5);
       setTopSellingProducts(topProducts);

        const alerts: StockAlert[] = inventory.reduce((acc, p) => {
            const minStockLevelOrDefault = p.minStockLevel ?? 10;
            const isDefaultMin = p.minStockLevel === undefined;

            if (p.quantity === 0) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Out of Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
            } else if (p.maxStockLevel !== undefined && p.quantity > p.maxStockLevel) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Over Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
            } else if (p.quantity <= minStockLevelOrDefault) {
                acc.push({ id: p.id, name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Low Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel, isDefaultMinStock: isDefaultMin });
            }
            return acc;
        }, [] as StockAlert[]);
        setStockAlerts(alerts.sort((a, b) => {
            const statusOrder = { 'Out of Stock': 1, 'Low Stock': 2, 'Over Stock': 3 };
            return statusOrder[a.status] - statusOrder[b.status];
        }));

     };

     generateReports();
   }, [dateRange, toast, inventory, invoices, isLoading, isMobile, t]);

   const pieChartData = useMemo(() => categoryDistribution, [categoryDistribution]);
   const lineChartData = useMemo(() => valueOverTime, [valueOverTime]);
   const processingBarChartData = useMemo(() => processingVolume, [processingVolume]);
   const salesByCategoryBarData = useMemo(() => salesByCategory, [salesByCategory]);
   const topSellingProductsBarData = useMemo(() => topSellingProducts, [topSellingProducts]);

   if (isLoading && !inventory.length && !invoices.length) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  return (
    <div className="container mx-auto p-2 sm:p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-primary shrink-0">{t('reports_title')}</h1>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-full md:w-auto md:min-w-[240px] justify-start text-left font-normal text-xs sm:text-sm",
                !dateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "PP")} - {format(dateRange.to, "PP")}
                  </>
                ) : (
                  format(dateRange.from, "PP")
                )
              ) : (
                <span>{t('reports_date_range_placeholder')}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
             <Calendar
               initialFocus
               mode="range"
               defaultMonth={dateRange?.from}
               selected={dateRange}
               onSelect={setDateRange}
               numberOfMonths={isMobile ? 1 : 2}
             />
            {dateRange && (
                <div className="p-2 border-t flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>{t('reports_date_range_clear')}</Button>
                </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

       {kpis && (
           <div className="grid gap-2 sm:gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
             <Card className="xl:col-span-2 scale-fade-in">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                 <CardTitle className="text-xs sm:text-sm font-medium">{t('reports_kpi_total_value')}</CardTitle>
                 <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent className="pb-2 sm:pb-4">
                 <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalValue, t, { currency: true })}</div>
                 <p className={cn("text-[10px] sm:text-xs", kpis.valueChangePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive dark:text-red-400")}>
                   {kpis.valueChangePercent >= 0 ? <TrendingUp className="inline h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" /> : <TrendingDown className="inline h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />}
                   {formatNumber(Math.abs(kpis.valueChangePercent), t, { decimals: 1, useGrouping: false })}% {t('reports_kpi_vs_last_period')}
                 </p>
               </CardContent>
             </Card>
             <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.05s'}}>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                 <CardTitle className="text-xs sm:text-sm font-medium">{t('reports_kpi_total_items')}</CardTitle>
                 <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent className="pb-2 sm:pb-4">
                 <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalItems, t, { decimals: 0, useGrouping: true })}</div>
                 <p className="text-[10px] sm:text-xs text-muted-foreground">{t('reports_kpi_unique_skus')}</p>
               </CardContent>
             </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.1s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">{t('kpi_gross_profit')}</CardTitle>
                    <HandCoins className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalPotentialGrossProfit, t, { currency: true })}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('reports_kpi_potential_from_stock')}</p>
                </CardContent>
            </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.15s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">{t('reports_kpi_gross_profit_margin')}</CardTitle>
                    <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.grossProfitMargin, t, { decimals: 1 })}%</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('reports_kpi_estimate')}</p>
                </CardContent>
            </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.2s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">{t('reports_kpi_inventory_turnover')}</CardTitle>
                    <Repeat className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.inventoryTurnoverRate, t, { decimals: 1 })}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('reports_kpi_times_per_period')}</p>
                </CardContent>
            </Card>
             <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.25s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">{t('reports_kpi_avg_order_value')}</CardTitle>
                    <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.averageOrderValue, t, { currency: true, decimals: 2, useGrouping: false})}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t('reports_kpi_from_invoices')}</p>
                </CardContent>
            </Card>
           </div>
       )}

        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.1s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">{t('reports_chart_value_over_time_title')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0 sm:p-0">
                    {lineChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[180px] sm:h-[220px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineChartData} margin={{ top: 5, right: isMobile ? 5 : 15, left: isMobile ? -25 : -10, bottom: isMobile ? 30 : 20 }}>
                                     <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                     <XAxis
                                        dataKey="date"
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        angle={isMobile ? -60 : -45}
                                        textAnchor="end"
                                        height={isMobile ? 40 : 30}
                                        interval={isMobile ? Math.max(0, Math.floor(lineChartData.length / 3) -1) : "preserveStartEnd"}
                                     />
                                     <YAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${t('currency_symbol')}${formatNumber(value / 1000, t, { decimals: 0})}k`}
                                        width={isMobile ? 30 : 40}
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="line" />}
                                        formatter={(value: number) => formatNumber(value, t, { currency: true })}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={t(chartConfig.value.labelKey)}/>
                                </LineChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                       <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_value_trend_data')}</p>
                    )}
                </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.2s'}}>
                 <CardHeader className="pb-2 sm:pb-4">
                     <CardTitle className="text-base sm:text-lg">{t('reports_chart_docs_processed_title')}</CardTitle>
                 </CardHeader>
                 <CardContent className="p-0 sm:p-0">
                      {processingBarChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[180px] sm:h-[220px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={processingBarChartData} margin={{ top: 5, right: isMobile ? 0 : 5, left: isMobile ? -20 : -15, bottom: isMobile ? 30 : 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis
                                        dataKey="period"
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        angle={isMobile ? -60 : -45}
                                        textAnchor="end"
                                        height={isMobile ? 40 : 30}
                                        interval={isMobile ? Math.max(0, Math.floor(processingBarChartData.length / 2) -1) : "preserveStartEnd"}
                                    />
                                     <YAxis
                                        stroke="hsl(var(--muted-foreground))"
                                        fontSize={isMobile ? 8 : 10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatNumber(value, t, { decimals: 0, useGrouping: true })}
                                        width={isMobile ? 25 : 30}
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                        formatter={(value: number) => formatNumber(value, t, { decimals: 0, useGrouping: true })}
                                     />
                                    <Bar dataKey="documents" fill="var(--color-documents)" radius={isMobile ? 2 : 3} barSize={isMobile ? 10 : undefined} name={t(chartConfig.documents.labelKey)}/>
                                </BarChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                     ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_processing_volume_data')}</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.3s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">{t('reports_chart_sales_by_category_title')}</CardTitle>
                </CardHeader>
                <CardContent className="p-0 sm:p-0">
                    {salesByCategoryBarData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[220px] sm:h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesByCategoryBarData} layout="vertical" margin={{ top: 5, right: isMobile ? 10 : 15, left: isMobile ? 5 : 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={isMobile ? 8 : 10} tickLine={false} axisLine={false} tickFormatter={(value) => formatNumber(value, t, { currency: true, decimals: 0})} />
                                    <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={isMobile ? 8 : 10} tickLine={false} axisLine={false} width={isMobile ? 50 : 60} />
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" />}
                                        formatter={(value: number) => formatNumber(value, t, { currency: true })}
                                    />
                                    <Bar dataKey="sales" fill="var(--color-sales)" radius={isMobile ? 2 : 3} barSize={isMobile ? 8 : undefined} name={t(chartConfig.sales.labelKey)}>
                                        {salesByCategoryBarData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_sales_by_category_data')}</p>
                    )}
                </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.4s'}}>
                 <CardHeader className="pb-2 sm:pb-4">
                     <CardTitle className="text-base sm:text-lg">{t('reports_chart_value_by_category_title')}</CardTitle>
                 </CardHeader>
                 <CardContent className="flex items-center justify-center p-0 sm:pb-2">
                     {pieChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[180px] sm:h-[230px]">
                           <ResponsiveContainer width="100%" height="100%">
                                <RechartsPieChart>
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent hideLabel indicator="dot" />}
                                        formatter={(value: number, name) => `${name}: ${formatNumber(value, t, { currency: true })}`}
                                    />
                                    <Pie
                                         data={pieChartData}
                                         dataKey="value"
                                         nameKey="name"
                                         cx="50%"
                                         cy="50%"
                                         outerRadius="80%"
                                         innerRadius={isMobile ? "45%" : "50%"}
                                         paddingAngle={1}
                                         labelLine={false}
                                         label={isMobile ? undefined : ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
                                            const RADIAN = Math.PI / 180;
                                            const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                            const x = cx + radius * Math.cos(-midAngle * RADIAN);
                                            const y = cy + radius * Math.sin(-midAngle * RADIAN);
                                            return (percent * 100) > 5 ? (
                                                <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize="10px">
                                                    {`${(percent * 100).toFixed(0)}%`}
                                                </text>
                                            ) : null;
                                        }}
                                    >
                                        {pieChartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                         ))}
                                     </Pie>
                                     <RechartsLegend
                                         content={({ payload }) => (
                                            <ul className="flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 mt-1 text-[9px] sm:text-[10px]">
                                                {payload?.map((entry, index) => (
                                                    <li key={`item-${index}`} className="flex items-center gap-1">
                                                        <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                        {entry.value}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                         verticalAlign="bottom"
                                         align="center"
                                         wrapperStyle={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                     />
                                 </RechartsPieChart>
                           </ResponsiveContainer>
                         </ChartContainer>
                     ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_chart_no_category_value_data')}</p>
                      )}
                 </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-2 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.5s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">{t('reports_table_top_selling_title')}</CardTitle>
                     <CardDescription className="text-xs sm:text-sm">{t('reports_table_top_selling_desc')}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {topSellingProductsBarData.length > 0 ? (
                         <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_product')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_qty_sold')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_total_value')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topSellingProductsBarData.map((product, index) => (
                                        <TableRow key={product.id || index}>
                                            <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{product.name}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.quantitySold, t, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.totalValue, t, { currency: true })}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_table_no_top_selling_data')}</p>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-2 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.6s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">{t('reports_table_stock_alert_title')}</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">{t('reports_table_stock_alert_desc')}</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {stockAlerts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_product')}</TableHead>
                                        <TableHead className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_catalog')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_current_qty')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_min_stock')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_max_stock')}</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{t('reports_table_col_status')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stockAlerts.map((alert) => (
                                        <TableRow key={alert.id}>
                                            <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{alert.name}</TableCell>
                                            <TableCell className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.catalogNumber}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(alert.quantity, t, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                {alert.isDefaultMinStock && alert.status === 'Low Stock'
                                                    ? `${formatNumber(10, t, { decimals: 0 })} (${t('reports_default_min_stock_suffix')})`
                                                    : (alert.minStock !== undefined ? formatNumber(alert.minStock, t, { decimals: 0 }) : '-')}
                                            </TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.maxStock !== undefined ? formatNumber(alert.maxStock, t, { decimals: 0 }) : '-'}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                <Badge variant={alert.status === 'Out of Stock' ? 'destructive' : (alert.status === 'Over Stock' ? 'default' : 'secondary')}
                                                    className={cn(
                                                        "whitespace-nowrap text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0.5",
                                                        alert.status === 'Low Stock' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80',
                                                        alert.status === 'Over Stock' && 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80'
                                                    )}
                                                >
                                                    <AlertTriangle className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                                    {t(`reports_stock_status_${alert.status.toLowerCase().replace(' ', '_')}` as any) || alert.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">{t('reports_table_no_stock_alerts')}</p>
                    )}
                </CardContent>
            </Card>

        </div>
    </div>
  );
}

