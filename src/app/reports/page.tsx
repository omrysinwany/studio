'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart as BarChartIcon, LineChart as LineChartIcon, PieChart as PieChartIcon, Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, RefreshCw, Users, ShoppingCart, Repeat } from 'lucide-react'; // Added more icons
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend } from 'recharts';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

// Helper function to safely format numbers
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


// Mock Data - Replace with actual API calls fetching aggregated data
const MOCK_KPIS_INITIAL = {
  totalValue: 15678.90,
  totalItems: 1234,
  lowStockItems: 2,
  inventoryTurnoverRate: 4.5, // New KPI
  averageOrderValue: 185.50, // New KPI (from invoices, needs real data eventually)
  grossProfitMargin: 35.2, // New KPI (conceptual, needs CoGS)
  valueChangePercent: 5.2,
  mostValuableCategory: 'Gadgets',
};

const MOCK_VALUE_OVER_TIME = [
  { date: '2024-01', value: 12000 },
  { date: '2024-02', value: 13500 },
  { date: '2024-03', value: 14000 },
  { date: '2024-04', value: 14800 },
  { date: '2024-05', value: 15200 },
  { date: '2024-06', value: 15678.90 },
];

const MOCK_CATEGORY_VALUE_DISTRIBUTION = [
  { name: 'Widgets', value: 5000 },
  { name: 'Gadgets', value: 8000 },
  { name: 'Components', value: 2678.90 },
  { name: 'Other', value: 1200 },
];

const MOCK_PROCESSING_VOLUME = [
  { period: 'Jan', count: 50 },
  { period: 'Feb', count: 65 },
  { period: 'Mar', count: 70 },
  { period: 'Apr', count: 80 },
  { period: 'May', count: 75 },
  { period: 'Jun', count: 89 },
];

// New Mock Data for additional charts
const MOCK_SALES_BY_CATEGORY = [
    { category: 'Widgets', sales: 7500.00 },
    { category: 'Gadgets', sales: 12000.00 },
    { category: 'Components', sales: 4000.50 },
    { category: 'Other', sales: 1800.75 },
];

const MOCK_TOP_SELLING_PRODUCTS = [
    { name: 'Super Widget', quantitySold: 150, totalValue: 2250.00 },
    { name: 'Mega Gadget', quantitySold: 95, totalValue: 4750.00 },
    { name: 'Basic Component A', quantitySold: 300, totalValue: 1500.00 },
    { name: 'Premium Other Item', quantitySold: 50, totalValue: 1000.00 },
    { name: 'Standard Widget', quantitySold: 120, totalValue: 1200.00 },
];

const MOCK_STOCK_ALERTS = [
    { name: 'Hyper Gadget X', quantity: 5, status: 'Low Stock', catalogNumber: 'HGX001' },
    { name: 'Regular Component B', quantity: 0, status: 'Out of Stock', catalogNumber: 'RCB002' },
    { name: 'Ultra Widget Pro', quantity: 8, status: 'Low Stock', catalogNumber: 'UWP003' },
];


const chartConfig = {
  value: { label: 'Value (₪)', color: 'hsl(var(--chart-1))' },
  count: { label: 'Count', color: 'hsl(var(--chart-2))' },
  sales: { label: 'Sales (₪)', color: 'hsl(var(--chart-3))' },
  quantitySold: { label: 'Quantity Sold', color: 'hsl(var(--chart-4))'},
  Widgets: { label: 'Widgets', color: 'hsl(var(--chart-1))' },
  Gadgets: { label: 'Gadgets', color: 'hsl(var(--chart-2))' },
  Components: { label: 'Components', color: 'hsl(var(--chart-3))' },
  Other: { label: 'Other', color: 'hsl(var(--chart-4))' },
  // Add entries for new chart data if needed, e.g., product names for top selling
} satisfies React.ComponentProps<typeof ChartContainer>["config"];

const PIE_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

export default function ReportsPage() {
  const [kpis, setKpis] = useState<typeof MOCK_KPIS_INITIAL | null>(null);
  const [valueOverTime, setValueOverTime] = useState<typeof MOCK_VALUE_OVER_TIME>([]);
  const [categoryDistribution, setCategoryDistribution] = useState<typeof MOCK_CATEGORY_VALUE_DISTRIBUTION>([]);
  const [processingVolume, setProcessingVolume] = useState<typeof MOCK_PROCESSING_VOLUME>([]);
  const [salesByCategory, setSalesByCategory] = useState<typeof MOCK_SALES_BY_CATEGORY>([]);
  const [topSellingProducts, setTopSellingProducts] = useState<typeof MOCK_TOP_SELLING_PRODUCTS>([]);
  const [stockAlerts, setStockAlerts] = useState<typeof MOCK_STOCK_ALERTS>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1),
    to: new Date(),
  });
  const { toast } = useToast();

   useEffect(() => {
     const fetchReports = async () => {
       setIsLoading(true);
       try {
         console.log('Fetching reports for date range:', dateRange);
         await new Promise(resolve => setTimeout(resolve, 1200));

         setKpis(MOCK_KPIS_INITIAL);
         setValueOverTime(MOCK_VALUE_OVER_TIME);
         setCategoryDistribution(MOCK_CATEGORY_VALUE_DISTRIBUTION.filter(item => item.value > 0));
         setProcessingVolume(MOCK_PROCESSING_VOLUME);
         setSalesByCategory(MOCK_SALES_BY_CATEGORY);
         setTopSellingProducts(MOCK_TOP_SELLING_PRODUCTS.sort((a,b) => b.totalValue - a.totalValue).slice(0,5)); // Top 5 by value
         setStockAlerts(MOCK_STOCK_ALERTS);

       } catch (error) {
         console.error("Failed to fetch report data:", error);
          toast({
            title: "Error Fetching Reports",
            description: "Could not load report data. Please try again later.",
            variant: "destructive",
          });
          setKpis(null);
          setValueOverTime([]);
          setCategoryDistribution([]);
          setProcessingVolume([]);
          setSalesByCategory([]);
          setTopSellingProducts([]);
          setStockAlerts([]);
       } finally {
         setIsLoading(false);
       }
     };

     fetchReports();
   }, [dateRange, toast]);


   const pieChartData = useMemo(() => categoryDistribution, [categoryDistribution]);
   const lineChartData = useMemo(() => valueOverTime, [valueOverTime]);
   const processingBarChartData = useMemo(() => processingVolume, [processingVolume]);
   const salesByCategoryBarData = useMemo(() => salesByCategory, [salesByCategory]);
   const topSellingProductsBarData = useMemo(() => topSellingProducts, [topSellingProducts]);


   if (isLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-primary shrink-0">Reports & Statistics</h1>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-full md:w-[300px] justify-start text-left font-normal",
                !dateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
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
               numberOfMonths={1}
               className="sm:hidden"
             />
             <Calendar
               initialFocus
               mode="range"
               defaultMonth={dateRange?.from}
               selected={dateRange}
               onSelect={setDateRange}
               numberOfMonths={2}
               className="hidden sm:block"
             />
            {dateRange && (
                <div className="p-2 border-t flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Clear</Button>
                </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* KPIs - Prioritized: Total Value, Total Items, Gross Profit Margin, Inventory Turnover */}
       {kpis && (
           <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
             {/* Total Value */}
             <Card className="xl:col-span-2">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Total Inventory Value</CardTitle>
                 <DollarSign className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{formatNumber(kpis.totalValue, { currency: true })}</div>
                 <p className={cn("text-xs", kpis.valueChangePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive dark:text-red-400")}>
                   {kpis.valueChangePercent >= 0 ? <TrendingUp className="inline h-3 w-3 mr-1" /> : <TrendingDown className="inline h-3 w-3 mr-1" />}
                   {formatNumber(Math.abs(kpis.valueChangePercent), { decimals: 1, useGrouping: false })}% vs last period
                 </p>
               </CardContent>
             </Card>
             {/* Total Items */}
             <Card>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Total Items in Stock</CardTitle>
                 <Package className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{formatNumber(kpis.totalItems, { decimals: 0, useGrouping: true })}</div>
                 <p className="text-xs text-muted-foreground">Unique SKUs</p>
               </CardContent>
             </Card>
            {/* Gross Profit Margin */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Gross Profit Margin</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatNumber(kpis.grossProfitMargin, { decimals: 1 })}%</div>
                    <p className="text-xs text-muted-foreground">Estimate</p>
                </CardContent>
            </Card>
            {/* Inventory Turnover Rate */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Inventory Turnover</CardTitle>
                    <Repeat className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatNumber(kpis.inventoryTurnoverRate, { decimals: 1 })}</div>
                    <p className="text-xs text-muted-foreground">Times per period</p>
                </CardContent>
            </Card>
             {/* Average Order Value */}
             <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Average Order Value</CardTitle>
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{formatNumber(kpis.averageOrderValue, { currency: true, decimals: 2})}</div>
                    <p className="text-xs text-muted-foreground">From processed invoices</p>
                </CardContent>
            </Card>
           </div>
       )}

        {/* Charts - Grouped by importance/relevance */}
        <div className="grid gap-6 md:grid-cols-2">
            {/* Value & Processing - Key operational charts */}
            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Inventory Value Over Time</CardTitle>
                </CardHeader>
                <CardContent className="pl-0 pr-2 pb-4">
                    {lineChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[200px] sm:h-[250px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                                     <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                     <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                                     <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => formatNumber(value / 1000, { currency: true, decimals: 0}) + 'k'} />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="line" />}
                                        formatter={(value: number) => formatNumber(value, { currency: true })}
                                    />
                                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                                </LineChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                       <p className="text-center text-muted-foreground py-10">No value trend data.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                 <CardHeader className="pb-4">
                     <CardTitle className="text-lg">Documents Processed Volume</CardTitle>
                 </CardHeader>
                 <CardContent className="pl-0 pr-2 pb-4">
                      {processingBarChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[200px] sm:h-[250px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={processingBarChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                                     <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => formatNumber(value, { decimals: 0, useGrouping: true })} />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                        formatter={(value: number) => formatNumber(value, { decimals: 0, useGrouping: true })}
                                     />
                                    <Bar dataKey="count" fill="var(--color-count)" radius={3} />
                                </BarChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                     ) : (
                        <p className="text-center text-muted-foreground py-10">No processing volume data.</p>
                     )}
                 </CardContent>
            </Card>

            {/* Sales & Category Performance */}
            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Sales by Category</CardTitle>
                </CardHeader>
                <CardContent className="pl-0 pr-2 pb-4">
                    {salesByCategoryBarData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[250px] sm:h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={salesByCategoryBarData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => formatNumber(value, { currency: true, decimals: 0})} />
                                    <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={80} />
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" />}
                                        formatter={(value: number) => formatNumber(value, { currency: true })}
                                    />
                                    <Bar dataKey="sales" fill="var(--color-sales)" radius={3}>
                                        {salesByCategoryBarData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                        <p className="text-center text-muted-foreground py-10">No sales by category data.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                 <CardHeader className="pb-4">
                     <CardTitle className="text-lg">Inventory Value by Category</CardTitle>
                 </CardHeader>
                 <CardContent className="flex items-center justify-center pb-4 sm:pb-8">
                     {pieChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[250px] sm:h-[300px]">
                           <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent hideLabel indicator="dot" />}
                                        formatter={(value: number, name) => `${name}: ${formatNumber(value, { currency: true })}`}
                                    />
                                    <Pie
                                         data={pieChartData}
                                         dataKey="value"
                                         nameKey="name"
                                         cx="50%"
                                         cy="50%"
                                         outerRadius={80}
                                         innerRadius={50}
                                         paddingAngle={2}
                                         labelLine={false}
                                    >
                                        {pieChartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                         ))}
                                     </Pie>
                                     <RechartsLegend
                                         content={<ChartLegendContent nameKey="name" />}
                                         verticalAlign="bottom"
                                         align="center"
                                         iconType="circle"
                                         wrapperStyle={{ paddingTop: 15, fontSize: '12px' }}
                                     />
                                 </PieChart>
                           </ResponsiveContainer>
                         </ChartContainer>
                     ) : (
                         <p className="text-center text-muted-foreground py-10">No category value data.</p>
                      )}
                 </CardContent>
            </Card>

            {/* Top Products & Stock Alerts - Important for actionable insights */}
            <Card className="md:col-span-2">
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Top Selling Products (by Value)</CardTitle>
                     <CardDescription>Top 5 products by total sales value in the selected period.</CardDescription>
                </CardHeader>
                <CardContent>
                    {topSellingProductsBarData.length > 0 ? (
                         <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead className="text-right">Quantity Sold</TableHead>
                                        <TableHead className="text-right">Total Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {topSellingProductsBarData.map((product, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{product.name}</TableCell>
                                            <TableCell className="text-right">{formatNumber(product.quantitySold, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right">{formatNumber(product.totalValue, { currency: true })}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-10">No top selling products data.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-2">
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Stock Alert Dashboard</CardTitle>
                    <CardDescription>Products requiring attention due to low or zero stock.</CardDescription>
                </CardHeader>
                <CardContent>
                    {stockAlerts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead>Catalog #</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead className="text-right">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stockAlerts.map((alert, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{alert.name}</TableCell>
                                            <TableCell>{alert.catalogNumber}</TableCell>
                                            <TableCell className="text-right">{formatNumber(alert.quantity, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={alert.status === 'Out of Stock' ? 'destructive' : 'secondary'}
                                                    className={cn(alert.status === 'Low Stock' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80')}
                                                >
                                                    <AlertTriangle className="mr-1 h-3 w-3" />
                                                    {alert.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                         <p className="text-center text-muted-foreground py-10">No stock alerts at the moment.</p>
                    )}
                </CardContent>
            </Card>

        </div>
    </div>
  );
}
