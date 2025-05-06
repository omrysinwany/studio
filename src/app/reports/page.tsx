
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart as BarChartIcon, LineChart as LineChartIcon, PieChart as PieChartIcon, Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from 'lucide-react'; // Renamed chart icons to avoid conflict
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Bar, BarChart, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend as RechartsLegend } from 'recharts'; // Keep recharts imports
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
// Removed useAuth, useRouter imports
import { useToast } from '@/hooks/use-toast';

// Helper function to safely format numbers to two decimal places
const formatNumber = (value: number | undefined | null, decimals: number = 2): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return '0.00'; // Or return '-' or 'N/A' based on preference
    }
    return value.toFixed(decimals);
};


// Mock Data - Replace with actual API calls fetching aggregated data
const MOCK_KPIS = {
  totalValue: 15678.90,
  totalItems: 1234,
  lowStockItems: 2, // Count of items with quantity <= 10
  mostValuableCategory: 'Gadgets',
  valueChangePercent: 5.2, // Percentage change from previous period
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
  { name: 'Other', value: 0 }, // Example with zero value
];

const MOCK_PROCESSING_VOLUME = [
  { period: 'Jan', count: 50 },
  { period: 'Feb', count: 65 },
  { period: 'Mar', count: 70 },
  { period: 'Apr', count: 80 },
  { period: 'May', count: 75 },
  { period: 'Jun', count: 89 },
];

const chartConfig = {
  value: { label: 'Value (₪)', color: 'hsl(var(--chart-1))' }, // Changed to ILS
  count: { label: 'Count', color: 'hsl(var(--chart-2))' },
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

export default function ReportsPage() {
  const [kpis, setKpis] = useState<typeof MOCK_KPIS | null>(null);
  const [valueOverTime, setValueOverTime] = useState<typeof MOCK_VALUE_OVER_TIME>([]);
  const [categoryDistribution, setCategoryDistribution] = useState<typeof MOCK_CATEGORY_VALUE_DISTRIBUTION>([]);
  const [processingVolume, setProcessingVolume] = useState<typeof MOCK_PROCESSING_VOLUME>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1), // Default to last 6 months
    to: new Date(),
  });
    // Removed user, authLoading, router
    const { toast } = useToast();

   // Fetch report data (replace with actual API calls)
   useEffect(() => {
     const fetchReports = async () => {
       // Removed user check
       setIsLoading(true);
       try {
         // Simulate API call delay
         console.log('Fetching reports for date range:', dateRange);
         await new Promise(resolve => setTimeout(resolve, 1200));

         // TODO: Replace MOCK data with actual API calls using dateRange
         // const kpiResponse = await fetch(`/api/reports/kpis?from=${dateRange?.from}&to=${dateRange?.to}`, ...);
         // const valueResponse = await fetch(`/api/reports/value-over-time?from=${dateRange?.from}&to=${dateRange?.to}`, ...);
         // const categoryResponse = await fetch(`/api/reports/category-distribution?from=${dateRange?.from}&to=${dateRange?.to}`, ...);
         // const volumeResponse = await fetch(`/api/reports/processing-volume?from=${dateRange?.from}&to=${dateRange?.to}`, ...);

         setKpis(MOCK_KPIS);
         setValueOverTime(MOCK_VALUE_OVER_TIME);
         // Filter out categories with 0 value for Pie chart
         setCategoryDistribution(MOCK_CATEGORY_VALUE_DISTRIBUTION.filter(item => item.value > 0));
         setProcessingVolume(MOCK_PROCESSING_VOLUME);

       } catch (error) {
         console.error("Failed to fetch report data:", error);
          toast({
            title: "Error Fetching Reports",
            description: "Could not load report data. Please try again later.",
            variant: "destructive",
          });
          // Optionally clear state on error
          setKpis(null);
          setValueOverTime([]);
          setCategoryDistribution([]);
          setProcessingVolume([]);
       } finally {
         setIsLoading(false);
       }
     };

     fetchReports(); // Fetch data directly
     // Removed authLoading and user dependencies
   }, [dateRange, toast]); // Re-fetch when dateRange changes


    // Removed useEffect for auth redirection


    // Memoize filtered data for charts based on the current state
   const pieChartData = useMemo(() => categoryDistribution, [categoryDistribution]);
   const lineChartData = useMemo(() => valueOverTime, [valueOverTime]);
   const barChartData = useMemo(() => processingVolume, [processingVolume]);


   if (isLoading) { // Removed authLoading check
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

    // Removed !user check

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-8">
      {/* Page Header and Date Range Picker */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-primary">Reports & Statistics</h1>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id="date"
              variant={"outline"}
              className={cn(
                "w-[300px] justify-start text-left font-normal",
                !dateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "LLL dd, y")} -{" "}
                    {format(dateRange.to, "LLL dd, y")}
                  </>
                ) : (
                  format(dateRange.from, "LLL dd, y")
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
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* KPIs */}
       {kpis && (
           <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
             <Card>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Total Inventory Value</CardTitle>
                 <DollarSign className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 {/* Use formatNumber for display */}
                 <div className="text-2xl font-bold">₪{formatNumber(kpis.totalValue)}</div> {/* Changed to ILS */}
                 <p className={cn("text-xs", kpis.valueChangePercent >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive dark:text-red-400")}>
                   {kpis.valueChangePercent >= 0 ? <TrendingUp className="inline h-3 w-3 mr-1" /> : <TrendingDown className="inline h-3 w-3 mr-1" />}
                   {/* Use formatNumber for percentage */}
                   {formatNumber(Math.abs(kpis.valueChangePercent), 1)}% from last period
                 </p>
               </CardContent>
             </Card>
             <Card>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Total Items</CardTitle>
                 <Package className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{kpis.totalItems.toLocaleString()}</div>
                 {/* <p className="text-xs text-muted-foreground">+201 since last month</p> */}
               </CardContent>
             </Card>
             <Card>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
                 <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{kpis.lowStockItems}</div>
                 <p className="text-xs text-muted-foreground">Items with quantity ≤ 10</p>
               </CardContent>
             </Card>
             <Card>
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                 <CardTitle className="text-sm font-medium">Most Valuable Category</CardTitle>
                 <TrendingUp className="h-4 w-4 text-muted-foreground" />
               </CardHeader>
               <CardContent>
                 <div className="text-2xl font-bold">{kpis.mostValuableCategory}</div>
                 {/* <p className="text-xs text-muted-foreground">Based on total value</p> */}
               </CardContent>
             </Card>
           </div>
       )}

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
            {/* Inventory Value Over Time */}
            <Card>
                <CardHeader>
                    <CardTitle>Inventory Value Over Time</CardTitle>
                    <CardDescription>Total value trend for the selected period.</CardDescription>
                </CardHeader>
                <CardContent>
                    {lineChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[250px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={lineChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                     <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                                     <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                     {/* Use formatNumber for YAxis tickFormatter */}
                                     <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `₪${formatNumber(value / 1000, 0)}k`} /> {/* Changed to ILS */}
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="line" />}
                                        // Use formatNumber for tooltip value
                                        formatter={(value: number) => `₪${formatNumber(value)}`} // Format tooltip value
                                    />
                                    <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                                </LineChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                    ) : (
                       <p className="text-center text-muted-foreground py-10">No data available for this period.</p>
                    )}
                </CardContent>
            </Card>

            {/* Document Processing Volume */}
            <Card>
                 <CardHeader>
                     <CardTitle>Document Processing Volume</CardTitle>
                     <CardDescription>Number of documents processed per period.</CardDescription>
                 </CardHeader>
                 <CardContent>
                      {barChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="h-[250px] w-full">
                           <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={barChartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                    <XAxis dataKey="period" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                     <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                     <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent indicator="dot" hideLabel />}
                                     />
                                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                                </BarChart>
                           </ResponsiveContainer>
                        </ChartContainer>
                     ) : (
                        <p className="text-center text-muted-foreground py-10">No data available for this period.</p>
                     )}
                 </CardContent>
            </Card>

            {/* Category Value Distribution */}
             <Card className="md:col-span-2"> {/* Span full width on medium screens */}
                 <CardHeader>
                     <CardTitle>Inventory Value by Category</CardTitle>
                     <CardDescription>Distribution of total inventory value across categories.</CardDescription>
                 </CardHeader>
                 <CardContent className="flex items-center justify-center pb-8">
                     {pieChartData.length > 0 ? (
                        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[300px]">
                           <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <RechartsTooltip
                                        cursor={false}
                                        content={<ChartTooltipContent hideLabel indicator="dot" />}
                                        // Use formatNumber for tooltip value
                                        formatter={(value: number, name) => `${name}: ₪${formatNumber(value)}`} // Format tooltip value
                                    />
                                    <Pie
                                         data={pieChartData}
                                         dataKey="value"
                                         nameKey="name"
                                         cx="50%"
                                         cy="50%"
                                         outerRadius={100}
                                         innerRadius={60} // Make it a donut chart
                                         paddingAngle={2}
                                         labelLine={false}
                                         // label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} // Optional labels
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
                                         wrapperStyle={{ paddingTop: 20 }}
                                     />
                                 </PieChart>
                           </ResponsiveContainer>
                         </ChartContainer>
                     ) : (
                         <p className="text-center text-muted-foreground py-10">No category data available for this period.</p>
                      )}
                 </CardContent>
             </Card>
        </div>

        {/* Optional Data Export */}
        {/* <div className="mt-8 text-center">
            <Button variant="outline">
                <Download className="mr-2 h-4 w-4" /> Export Reports (CSV/PDF)
            </Button>
        </div> */}
    </div>
  );
}
