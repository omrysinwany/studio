
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart as BarChartIcon, LineChart as LineChartIcon, PieChart as PieChartIcon, Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, RefreshCw, Users, ShoppingCart, Repeat } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend } from 'recharts';
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
import { calculateInventoryValue, calculateTotalItems, getLowStockItems, calculateGrossProfitMargin, calculateInventoryTurnoverRate, calculateAverageOrderValue } from '@/lib/kpi-calculations';

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
  Widgets: { label: 'Widgets', color: 'hsl(var(--chart-1))' },
  Gadgets: { label: 'Gadgets', color: 'hsl(var(--chart-2))' },
  Components: { label: 'Components', color: 'hsl(var(--chart-3))' },
  Other: { label: 'Other', color: 'hsl(var(--chart-4))' },
} satisfies React.ComponentProps<typeof ChartContainer>["config"];

const PIE_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

interface StockAlert {
  name: string;
  catalogNumber: string;
  quantity: number;
  status: 'Low Stock' | 'Out of Stock' | 'Over Stock';
  minStock?: number;
  maxStock?: number;
}


export default function ReportsPage() {
  const [kpis, setKpis] = useState<any | null>(null);
  const [valueOverTime, setValueOverTime] = useState<any[]>([]); // Ensure array type
  const [categoryDistribution, setCategoryDistribution] = useState<any[]>([]); // Ensure array type
  const [processingVolume, setProcessingVolume] = useState<any[]>([]); // Ensure array type
  const [salesByCategory, setSalesByCategory] = useState<any[]>([]); // Ensure array type
  const [topSellingProducts, setTopSellingProducts] = useState<any[]>([]); // Ensure array type
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]); // Ensure array type

  const [inventory, setInventory] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subMonths(new Date(), 1), // Default to last month
    to: new Date(),
  });
  const { toast } = useToast();

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
       if (isLoading || inventory.length === 0) return; // Don't generate if loading or no inventory

       // Filter invoices based on dateRange
       const filteredInvoices = invoices.filter(invoice => {
         const invoiceDate = new Date(invoice.uploadTime);
         if (dateRange?.from && invoiceDate < dateRange.from) return false;
         if (dateRange?.to && invoiceDate > dateRange.to) return false;
         return true;
       });


       const totalValue = calculateInventoryValue(inventory);
       const totalItemsCount = calculateTotalItems(inventory);
       const lowStockItems = getLowStockItems(inventory).length;

       // Placeholder - need actual revenue and COGS data
       const mockTotalRevenue = filteredInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0) * 1.5; // Simulate revenue
       const mockCogs = mockTotalRevenue * 0.65; // Simulate COGS
       const grossProfitMargin = calculateGrossProfitMargin(mockTotalRevenue, mockCogs);
       const inventoryTurnoverRate = calculateInventoryTurnoverRate(mockCogs, totalValue / 2); // Avg inventory
       const averageOrderValue = calculateAverageOrderValue(filteredInvoices);

       setKpis({
         totalValue,
         totalItems: totalItemsCount,
         lowStockItems,
         grossProfitMargin,
         inventoryTurnoverRate,
         averageOrderValue,
         valueChangePercent: Math.random() * 10 - 5, // Random change for mock
       });

       // Mock Value Over Time (replace with actual logic)
       const votData = [];
       let currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       const endDate = dateRange?.to || new Date();
       while (currentDate <= endDate) {
           votData.push({
               date: format(currentDate, "MMM dd"),
               value: totalValue * (0.8 + Math.random() * 0.4) // Simulate fluctuations
           });
           currentDate.setDate(currentDate.getDate() + 7); // Weekly data points
       }
       setValueOverTime(votData);


       // Category Distribution (Mock - needs product categories)
       const categories = ['Electronics', 'Clothing', 'Home Goods', 'Books', 'Other'];
       const catDistData = categories.map(cat => ({
           name: cat,
           value: Math.floor(Math.random() * 5000) + 1000
       }));
       setCategoryDistribution(catDistData);


       // Processing Volume (Based on filtered invoices)
       const procVolData = [];
       currentDate = dateRange?.from ? new Date(dateRange.from) : subMonths(new Date(), 6);
       while (currentDate <= endDate) {
           const monthStr = format(currentDate, "MMM yyyy");
           const count = filteredInvoices.filter(inv => format(new Date(inv.uploadTime), "MMM yyyy") === monthStr).length;
           if(!procVolData.find(d => d.period === monthStr)) { // Avoid duplicates if iterating too fast
             procVolData.push({ period: monthStr, count });
           }
           currentDate.setMonth(currentDate.getMonth() + 1);
       }
       setProcessingVolume(procVolData);


       // Sales by Category (Mock - needs product categories & sales data)
       setSalesByCategory(categories.map(cat => ({ category: cat, sales: Math.floor(Math.random() * 10000) + 2000 })));

       // Top Selling Products (Mock - needs sales data per product)
        const topProducts = inventory.slice(0, 5).map(p => ({
            name: p.shortName || p.description.slice(0,20),
            quantitySold: Math.floor(Math.random() * 100) + 10,
            totalValue: (p.unitPrice || 0) * (Math.floor(Math.random() * 100) + 10)
        })).sort((a,b) => b.totalValue - a.totalValue);
       setTopSellingProducts(topProducts);

       // Stock Alerts
       const alerts: StockAlert[] = inventory.reduce((acc, p) => {
           if (p.quantity === 0) {
               acc.push({ name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Out of Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
           } else if (p.minStockLevel !== undefined && p.quantity <= p.minStockLevel) {
               acc.push({ name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Low Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
           } else if (p.maxStockLevel !== undefined && p.quantity > p.maxStockLevel) {
                acc.push({ name: p.shortName || p.description, catalogNumber: p.catalogNumber, quantity: p.quantity, status: 'Over Stock', minStock: p.minStockLevel, maxStock: p.maxStockLevel });
           }
           return acc;
       }, [] as StockAlert[]);
       setStockAlerts(alerts);

     };

     generateReports();
   }, [dateRange, toast, inventory, invoices, isLoading]); // Re-run if these change

   const pieChartData = useMemo(() => categoryDistribution, [categoryDistribution]);
   const lineChartData = useMemo(() => valueOverTime, [valueOverTime]);
   const processingBarChartData = useMemo(() => processingVolume, [processingVolume]);
   const salesByCategoryBarData = useMemo(() => salesByCategory, [salesByCategory]);
   const topSellingProductsBarData = useMemo(() => topSellingProducts, [topSellingProducts]);

   if (isLoading && !inventory.length && !invoices.length) { // Show loader only on initial full load
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

       {kpis && (
           <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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

        <div className="grid gap-6 md:grid-cols-2">
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
                       <p className="text-center text-muted-foreground py-10">No value trend data for selected period.</p>
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
                        <p className="text-center text-muted-foreground py-10">No processing volume data for selected period.</p>
                     )}
                 </CardContent>
            </Card>

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
                        <p className="text-center text-muted-foreground py-10">No sales by category data for selected period.</p>
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
                        <p className="text-center text-muted-foreground py-10">No top selling products data for selected period.</p>
                    )}
                </CardContent>
            </Card>

            <Card className="md:col-span-2">
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Stock Alert Dashboard</CardTitle>
                    <CardDescription>Products requiring attention based on defined stock levels.</CardDescription>
                </CardHeader>
                <CardContent>
                    {stockAlerts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead>Catalog #</TableHead>
                                        <TableHead className="text-right">Current Qty</TableHead>
                                        <TableHead className="text-right">Min Stock</TableHead>
                                        <TableHead className="text-right">Max Stock</TableHead>
                                        <TableHead className="text-right">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {stockAlerts.map((alert, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{alert.name}</TableCell>
                                            <TableCell>{alert.catalogNumber}</TableCell>
                                            <TableCell className="text-right">{formatNumber(alert.quantity, { decimals: 0 })}</TableCell>
                                            <TableCell className="text-right">{alert.minStock !== undefined ? formatNumber(alert.minStock, { decimals: 0 }) : '-'}</TableCell>
                                            <TableCell className="text-right">{alert.maxStock !== undefined ? formatNumber(alert.maxStock, { decimals: 0 }) : '-'}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={alert.status === 'Out of Stock' ? 'destructive' : (alert.status === 'Over Stock' ? 'default' : 'secondary')}
                                                    className={cn(
                                                        alert.status === 'Low Stock' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80',
                                                        alert.status === 'Over Stock' && 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80'
                                                    )}
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
