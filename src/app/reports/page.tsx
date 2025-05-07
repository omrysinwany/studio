'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, Repeat, ShoppingCart, FileText, HandCoins } from 'lucide-react'; // Added HandCoins
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, PieChart as RechartsPie, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend } from 'recharts';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
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
    calculateTotalPotentialGrossProfit // Added calculateTotalPotentialGrossProfit
} from '@/lib/kpi-calculations';

const formatNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 2, useGrouping = true, currency = false } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
        return currency ? `₪${zeroFormatted}` : zeroFormatted;
    }

    const formatted = value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
    return currency ? `₪${formatted}` : formatted;
};


const chartConfig = {
  value: { label: 'Value (₪)', color: 'hsl(var(--chart-1))' },
  count: { label: 'Count', color: 'hsl(var(--chart-2))' },
  sales: { label: 'Sales (₪)', color: 'hsl(var(--chart-3))' },
  quantitySold: { label: 'Quantity Sold', color: 'hsl(var(--chart-4))'},
  documents: { label: 'Documents', color: 'hsl(var(--chart-5))' }
} satisfies React.ComponentProps<typeof ChartContainer>["config"];

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
                    title: "Error Fetching Data",
                    description: "Could not load inventory or invoice data.",
                    variant: "destructive",
                });
                setInventory([]);
                setInvoices([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialData();
    }, [toast]);

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
       const totalPotentialGrossProfit = calculateTotalPotentialGrossProfit(inventory); // Calculate gross profit


       const mockTotalRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0) * 1.5; // Mock factor
       const mockCogs = mockTotalRevenue * 0.65; // Mock COGS
       const grossProfitMargin = calculateGrossProfitMargin(mockTotalRevenue, mockCogs);
       const inventoryTurnoverRate = calculateInventoryTurnoverRate(mockCogs, totalValue > 0 ? totalValue / 2 : 1); // Use average inventory value (mocked as half current)
       const averageOrderValue = calculateAverageOrderValue(filteredInvoices);

       setKpis({
         totalValue,
         totalItems: totalItemsCount,
         lowStockItems: lowStockItemsCount,
         grossProfitMargin,
         inventoryTurnoverRate,
         averageOrderValue,
         totalPotentialGrossProfit, // Add to KPIs
         valueChangePercent: Math.random() * 10 - 5, // Mock value change
       });

       // Generate Inventory Value Over Time data
       const votData = [];
       let currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const endDate = dateRange?.to || new Date();
       const numPoints = isMobile ? 5 : 10; // Fewer points for mobile
       const step = Math.max(1, Math.floor((endDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * numPoints)));

       while (currentDate <= endDate) {
           const monthStr = format(currentDate, "MMM dd");
           // Simulate value based on filtered invoices up to this date (very rough simulation)
           const invoicesUpToDate = invoices.filter(inv => new Date(inv.uploadTime) <= currentDate);
           const simulatedValue = invoicesUpToDate.reduce((sum, inv) => sum + (inv.totalAmount || 0),0) * (0.8 + Math.random() * 0.4); // Mock factor
           votData.push({
               date: monthStr,
               value: simulatedValue,
           });
           currentDate.setDate(currentDate.getDate() + step);
       }
       setValueOverTime(votData);


       // Generate Inventory Value by Category data (mock categories for now)
       const categories = ['Electronics', 'Clothing', 'Home Goods', 'Books', 'Other']; // Mock categories
        const catDistData = categories.map(cat => {
            // Simulate category distribution based on product descriptions (very basic)
            const categoryProducts = inventory.filter(p => (p.description.toLowerCase().includes(cat.slice(0,4).toLowerCase())) || (cat === 'Other' && !categories.slice(0,-1).some(c => p.description.toLowerCase().includes(c.slice(0,4).toLowerCase()))));
            return {
                name: cat,
                value: calculateInventoryValue(categoryProducts)
            };
        }).filter(c => c.value > 0); // Only show categories with value
       setCategoryDistribution(catDistData);

       // Generate Documents Processed Volume
       const procVolData = [];
       currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const procVolNumPoints = isMobile ? 3 : 5; // Fewer points for mobile
       const procVolStep = Math.max(1, Math.floor((endDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24 * 30 * procVolNumPoints))); // Monthly steps

        while (currentDate <= endDate) {
           const monthStr = format(currentDate, "MMM yy");
           const count = filteredInvoices.filter(inv => format(new Date(inv.uploadTime), "MMM yy") === monthStr).length;
           if(!procVolData.find(d => d.period === monthStr)) { // Avoid duplicates if step is small
             procVolData.push({ period: monthStr, documents: count });
           }
           currentDate.setMonth(currentDate.getMonth() + procVolStep);
       }
       setProcessingVolume(procVolData);

       // Generate Sales by Category (mock data, needs real sales data integration)
       const mockSalesByCategoryData = categories.map(cat => ({ category: cat, sales: Math.floor(Math.random() * 10000) + 2000 }));
       setSalesByCategory(mockSalesByCategoryData);


        // Generate Top Selling Products (mocking sales volume for now)
        const topProducts = inventory
            .map(p => ({
                id: p.id,
                name: p.shortName || p.description.slice(0,25) + (p.description.length > 25 ? '...' : ''),
                quantitySold: Math.floor(Math.random() * (p.quantity > 0 ? p.quantity : 10)) + 1, // Mock sold quantity
                totalValue: (p.salePrice || p.unitPrice || 0) * (Math.floor(Math.random() * (p.quantity > 0 ? p.quantity : 10)) + 1) // Use salePrice if available for mock total value
            }))
            .sort((a,b) => b.totalValue - a.totalValue) // Sort by total value
            .slice(0, 5); // Top 5
       setTopSellingProducts(topProducts);

        // Generate Stock Alerts
        const alerts: StockAlert[] = inventory.reduce((acc, p) => {
            const minStockLevelOrDefault = p.minStockLevel ?? 10; // Default min stock if not set
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
        setStockAlerts(alerts.sort((a, b) => { // Sort alerts for consistent display
            const statusOrder = { 'Out of Stock': 1, 'Low Stock': 2, 'Over Stock': 3 };
            return statusOrder[a.status] - statusOrder[b.status];
        }));

     };

     generateReports();
   }, [dateRange, toast, inventory, invoices, isLoading, isMobile]);

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
        <h1 className="text-xl sm:text-2xl font-bold text-primary shrink-0">Reports &amp; Statistics</h1>
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
                <span>Pick a date range</span>
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
                    <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Clear</Button>
                </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

       {kpis && (
           <div className="grid gap-2 sm:gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-7">
             <Card className="xl:col-span-2 scale-fade-in">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                 <CardTitle className="text-xs sm:text-sm font-medium">Total Inventory Value</CardTitle>
                 <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent className="pb-2 sm:pb-4">
                 <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalValue, { currency: true })}</div>
                 <p className={cn("text-[10px] sm:text-xs", kpis.valueChangePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive dark:text-red-400")}>
                   {kpis.valueChangePercent >= 0 ? <TrendingUp className="inline h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" /> : <TrendingDown className="inline h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5 sm:mr-1" />}
                   {formatNumber(Math.abs(kpis.valueChangePercent), { decimals: 1, useGrouping: false })}% vs last period
                 </p>
               </CardContent>
             </Card>
             <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.05s'}}>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                 <CardTitle className="text-xs sm:text-sm font-medium">Total Items in Stock</CardTitle>
                 <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent className="pb-2 sm:pb-4">
                 <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalItems, { decimals: 0, useGrouping: true })}</div>
                 <p className="text-[10px] sm:text-xs text-muted-foreground">Unique SKUs</p>
               </CardContent>
             </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.1s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">Total Gross Profit</CardTitle>
                    <HandCoins className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.totalPotentialGrossProfit, { currency: true })}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">Potential from stock</p>
                </CardContent>
            </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.15s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">Gross Profit Margin</CardTitle>
                    <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.grossProfitMargin, { decimals: 1 })}%</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">Estimate</p>
                </CardContent>
            </Card>
            <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.2s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">Inventory Turnover</CardTitle>
                    <Repeat className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.inventoryTurnoverRate, { decimals: 1 })}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">Times per period</p>
                </CardContent>
            </Card>
             <Card className="scale-fade-in xl:col-span-1" style={{animationDelay: '0.25s'}}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
                    <CardTitle className="text-xs sm:text-sm font-medium">Avg. Order Value</CardTitle>
                    <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="pb-2 sm:pb-4">
                    <div className="text-lg sm:text-2xl font-bold">{formatNumber(kpis.averageOrderValue, { currency: true, decimals: 2})}</div>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">From invoices</p>
                </CardContent>
            </Card>
           </div>
       )}

        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.1s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">Inventory Value Over Time</CardTitle>
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
                                        tickFormatter={(value) => formatNumber(value / 1000, { currency: true, decimals: 0}) + 'k'}
                                        width={isMobile ? 30 : 40} 
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="line" />}
                                        formatter={(value: number) => formatNumber(value, { currency: true })}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                                </LineChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                       <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No value trend data for selected period.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.2s'}}>
                 <CardHeader className="pb-2 sm:pb-4">
                     <CardTitle className="text-base sm:text-lg">Documents Processed Volume</CardTitle>
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
                                        tickFormatter={(value) => formatNumber(value, { decimals: 0, useGrouping: true })}
                                        width={isMobile ? 25 : 30}
                                     />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                        formatter={(value: number) => formatNumber(value, { decimals: 0, useGrouping: true })}
                                     />
                                    <Bar dataKey="documents" fill="var(--color-documents)" radius={isMobile ? 2 : 3} barSize={isMobile ? 10 : undefined}/>
                                </BarChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                     ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No processing volume data.</p>
                     )}
                 </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.3s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">Sales by Category</CardTitle>
                </CardHeader>
                <CardContent className="p-0 sm:p-0">
                    {salesByCategoryBarData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[220px] sm:h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesByCategoryBarData} layout="vertical" margin={{ top: 5, right: isMobile ? 10 : 15, left: isMobile ? 5 : 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={isMobile ? 8 : 10} tickLine={false} axisLine={false} tickFormatter={(value) => formatNumber(value, { currency: true, decimals: 0})} />
                                    <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={isMobile ? 8 : 10} tickLine={false} axisLine={false} width={isMobile ? 45 : 55} interval={0} />
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" />}
                                        formatter={(value: number) => formatNumber(value, { currency: true })}
                                    />
                                    <Bar dataKey="sales" fill="var(--color-sales)" radius={isMobile ? 2 : 3} barSize={isMobile ? 8 : undefined}>
                                        {salesByCategoryBarData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No sales by category data.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.4s'}}>
                 <CardHeader className="pb-2 sm:pb-4">
                     <CardTitle className="text-base sm:text-lg">Inventory Value by Category</CardTitle>
                 </CardHeader>
                 <CardContent className="flex items-center justify-center p-0 sm:pb-2">
                     {pieChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[180px] sm:h-[230px]">
                           <ResponsiveContainer width="100%" height="100%">
                                <RechartsPie>
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent hideLabel indicator="dot" />}
                                        formatter={(value: number, name) => `${name}: ${formatNumber(value, { currency: true })}`}
                                    />
                                    <RechartsPie
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
                                     </RechartsPie>
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
                                 </RechartsPie>
                           </ResponsiveContainer>
                         </ChartContainer>
                     ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No category value data.</p>
                      )}
                 </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-2 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.5s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">Top Selling Products (by Value)</CardTitle>
                     <CardDescription className="text-xs sm:text-sm">Top 5 products by total sales value in the selected period.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {topSellingProductsBarData.length > 0 ? (
                         <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Product</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Qty Sold</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Total Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topSellingProductsBarData.map((product, index) => (
                                        <TableRow key={product.id || index}>
                                            <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{product.name}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.quantitySold, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(product.totalValue, { currency: true })}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No top selling products data.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-full lg:col-span-2 w-full overflow-hidden scale-fade-in" style={{animationDelay: '0.6s'}}>
                <CardHeader className="pb-2 sm:pb-4">
                    <CardTitle className="text-base sm:text-lg">Stock Alert Dashboard</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">Products requiring attention based on defined stock levels.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {stockAlerts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Product</TableHead>
                                        <TableHead className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">Catalog #</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Current Qty</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">Min Stock</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">Max Stock</TableHead>
                                        <TableHead className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stockAlerts.map((alert) => (
                                        <TableRow key={alert.id}>
                                            <TableCell className="font-medium text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5 truncate max-w-[100px] sm:max-w-xs">{alert.name}</TableCell>
                                            <TableCell className="text-[10px] sm:text-xs hidden md:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.catalogNumber}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">{formatNumber(alert.quantity, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                {alert.isDefaultMinStock && alert.status === 'Low Stock'
                                                    ? `${formatNumber(10, { decimals: 0 })} (Def.)`
                                                    : (alert.minStock !== undefined ? formatNumber(alert.minStock, { decimals: 0 }) : '-')}
                                            </TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs hidden sm:table-cell px-1.5 sm:px-2 py-1 sm:py-1.5">{alert.maxStock !== undefined ? formatNumber(alert.maxStock, { decimals: 0 }) : '-'}</TableCell>
                                            <TableCell className="text-right text-[10px] sm:text-xs px-1.5 sm:px-2 py-1 sm:py-1.5">
                                                <Badge variant={alert.status === 'Out of Stock' ? 'destructive' : (alert.status === 'Over Stock' ? 'default' : 'secondary')}
                                                    className={cn(
                                                        "whitespace-nowrap text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0.5",
                                                        alert.status === 'Low Stock' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80',
                                                        alert.status === 'Over Stock' && 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80'
                                                    )}
                                                >
                                                    <AlertTriangle className="mr-0.5 sm:mr-1 h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                                    {alert.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                         <p className="text-center text-muted-foreground py-8 sm:py-10 text-xs sm:text-sm">No stock alerts at the moment.</p>
                    )}
                </CardContent>
            </Card>

        </div>
    </div>
  );
}
