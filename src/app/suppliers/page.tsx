'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getSupplierSummariesService, SupplierSummary, InvoiceHistoryItem, getInvoicesService } from '@/services/backend';
import { Briefcase, Search, DollarSign, FileText, Loader2, Info, ChevronDown, ChevronUp, ExternalLink, Phone, Mail, BarChart3, ListChecks, PieChart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Cell, Pie, PieChart as RechartsPie } from 'recharts';
import { Separator } from '@/components/ui/separator';

const ITEMS_PER_PAGE = 10;

type SortKey = keyof Pick<SupplierSummary, 'name' | 'invoiceCount'> | ''; // Removed 'totalSpent'
type SortDirection = 'asc' | 'desc';

const formatCurrency = (value: number | undefined | null): string => {
  if (value === undefined || value === null || isNaN(value)) return '₪0.00';
  return `₪${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (date: Date | string | undefined, f: string = 'PP') => {
  if (!date) return 'N/A';
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return format(dateObj, f);
  } catch (e) {
    console.error("Error formatting date:", e, "Input:", date);
    return 'Invalid Date';
  }
};


const renderStatusBadge = (status: InvoiceHistoryItem['status']) => {
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
    let className = '';
    let icon = null;

    switch (status) {
        case 'completed':
            variant = 'secondary';
            className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        case 'processing':
            variant = 'secondary';
            className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
            icon = <Loader2 className="mr-1 h-3 w-3 animate-spin" />;
            break;
        case 'pending':
            variant = 'secondary';
            className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        case 'error':
            variant = 'destructive';
            icon = <Info className="mr-1 h-3 w-3" />;
            break;
        default:
            variant = 'outline';
            icon = null;
            break;
    }
    return (
        <Badge variant={variant} className={cn("text-[10px] sm:text-xs font-medium px-1.5 sm:px-2 py-0.5", className)}>
            {icon}
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
    );
};

interface MonthlySpendingData {
  month: string;
  total: number;
}

const PIE_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF4560'];


export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name'); // Default sort by name
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSummary | null>(null);
  const [selectedSupplierInvoices, setSelectedSupplierInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [monthlySpendingData, setMonthlySpendingData] = useState<MonthlySpendingData[]>([]);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [categorySpendingData, setCategorySpendingData] = useState<{ name: string; value: number }[]>([]);


  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [summaries, invoicesData] = await Promise.all([
          getSupplierSummariesService(),
          getInvoicesService()
        ]);
        setSuppliers(summaries);
        setAllInvoices(invoicesData.map(inv => ({...inv, uploadTime: inv.uploadTime })));
      } catch (error) {
        console.error("Failed to fetch supplier data:", error);
        toast({
          title: "Error Loading Data",
          description: "Could not load supplier information.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const filteredAndSortedSuppliers = useMemo(() => {
    let result = [...suppliers];
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(s => s.name.toLowerCase().includes(lowerSearchTerm));
    }

    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey as keyof Pick<SupplierSummary, 'name' | 'invoiceCount'>];
        const valB = b[sortKey as keyof Pick<SupplierSummary, 'name' | 'invoiceCount'>];
        let comparison = 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
          comparison = valA - valB;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          comparison = valA.localeCompare(valB);
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }
    return result;
  }, [suppliers, searchTerm, sortKey, sortDirection]);

  const totalItems = filteredAndSortedSuppliers.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const paginatedSuppliers = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedSuppliers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedSuppliers, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleViewSupplierDetails = (supplier: SupplierSummary) => {
    setSelectedSupplier(supplier);
    const invoicesForSupplier = allInvoices.filter(inv => inv.supplier === supplier.name)
                                      .sort((a,b) => new Date(b.uploadTime as string).getTime() - new Date(a.uploadTime as string).getTime());
    setSelectedSupplierInvoices(invoicesForSupplier);

    // Calculate monthly spending for the last 12 months
    const last12Months = eachMonthOfInterval({
        start: subMonths(new Date(), 11),
        end: new Date()
    });

    const spendingByMonth: Record<string, number> = {};
    last12Months.forEach(monthDate => {
        const monthYear = format(monthDate, 'MMM yyyy');
        spendingByMonth[monthYear] = 0; // Initialize all months in range
    });

    invoicesForSupplier.forEach(invoice => {
      if (invoice.totalAmount && invoice.status === 'completed') {
        const monthYear = formatDate(invoice.uploadTime as string, 'MMM yyyy');
        if(spendingByMonth.hasOwnProperty(monthYear)){ // Only count if within the last 12 months
            spendingByMonth[monthYear] = (spendingByMonth[monthYear] || 0) + invoice.totalAmount;
        }
      }
    });
    const chartData = Object.entries(spendingByMonth)
      .map(([month, total]) => ({ month, total }))
      .sort((a,b) => new Date(a.month).getTime() - new Date(b.month).getTime());
    setMonthlySpendingData(chartData);


    // Calculate spending by product category (mock example - needs actual product data linkage)
    const spendingByCategory: Record<string, number> = {
        'Electronics': Math.random() * 5000,
        'Office Supplies': Math.random() * 3000,
        'Services': Math.random() * 2000,
        'Other': Math.random() * 1000,
    };
     setCategorySpendingData(
        Object.entries(spendingByCategory)
            .map(([name, value]) => ({name, value}))
            .filter(item => item.value > 0) // Only include categories with spending
     );


    setIsSheetOpen(true);
  };
  
  const navigateToInvoiceDetails = (invoiceId: string) => {
    router.push(`/invoices?viewInvoiceId=${invoiceId}`);
    setIsSheetOpen(false);
  };


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Briefcase className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> Suppliers Overview
          </CardTitle>
          <CardDescription>Manage and review your suppliers and their order history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-10"
                aria-label="Search suppliers"
              />
            </div>
          </div>

          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('name')}>
                    Supplier Name {sortKey === 'name' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                  <TableHead className="text-center cursor-pointer hover:bg-muted/50" onClick={() => handleSort('invoiceCount')}>
                    Orders {sortKey === 'invoiceCount' && (sortDirection === 'asc' ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />)}
                  </TableHead>
                   <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSuppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center"> {/* Adjusted colSpan */}
                      No suppliers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSuppliers.map((supplier) => (
                    <TableRow key={supplier.name} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{supplier.name}</TableCell>
                      <TableCell className="text-center">{supplier.invoiceCount}</TableCell>
                       <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => handleViewSupplierDetails(supplier)} title={`View details for ${supplier.name}`}>
                          <Info className="h-4 w-4 text-primary" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-end space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl flex flex-col p-0">
          <SheetHeader className="p-4 sm:p-6 border-b shrink-0">
            <SheetTitle className="text-lg sm:text-xl">{selectedSupplier?.name || 'Supplier Details'}</SheetTitle>
            <SheetDescription>
              Contact information, spending analysis, and order history for {selectedSupplier?.name}.
            </SheetDescription>
          </SheetHeader>
          {selectedSupplier && (
            <ScrollArea className="flex-grow">
              <div className="p-4 sm:p-6 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><DollarSign className="mr-2 h-4 w-4 text-primary" /> Total Spending</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-primary">{formatCurrency(selectedSupplier.totalSpent)}</p>
                    <p className="text-xs text-muted-foreground">Across {selectedSupplier.invoiceCount} orders</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><Info className="mr-2 h-4 w-4 text-primary" /> Contact (Placeholder)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p className="flex items-center"><Phone className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> N/A</p>
                    <p className="flex items-center"><Mail className="mr-2 h-3.5 w-3.5 text-muted-foreground"/> N/A</p>
                  </CardContent>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center"><BarChart3 className="mr-2 h-4 w-4 text-primary" /> Monthly Spending (Last 12 Months)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {monthlySpendingData.length > 0 && monthlySpendingData.some(d => d.total > 0) ? (
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={monthlySpendingData} margin={{ top: 5, right: 0, left: -25, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis fontSize={10} tickFormatter={(value) => `₪${value/1000}k`} tickLine={false} axisLine={false}/>
                            <RechartsTooltip formatter={(value: number) => [formatCurrency(value), "Total Spent"]}/>
                            <Legend wrapperStyle={{fontSize: "12px"}}/>
                            <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Spending"/>
                            </BarChart>
                        </ResponsiveContainer>
                        ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No spending data available for the last 12 months.</p>
                        )}
                    </CardContent>
                </Card>

                 <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center"><PieChart className="mr-2 h-4 w-4 text-primary" /> Spending by Category (Example)</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                         {categorySpendingData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={200}>
                                <RechartsPie>
                                    <RechartsPie data={categorySpendingData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} labelLine={false}
                                        label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }) => {
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
                                    {categorySpendingData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                    ))}
                                    </RechartsPie>
                                    <RechartsTooltip formatter={(value: number, name: string) => [formatCurrency(value), name]} />
                                    <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={10} wrapperStyle={{fontSize: "12px", lineHeight: "1.5"}}/>
                                </RechartsPie>
                            </ResponsiveContainer>
                         ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">No category spending data available.</p>
                         )}
                    </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center"><ListChecks className="mr-2 h-4 w-4 text-primary" /> Activity Timeline (Recent Invoices)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSupplierInvoices.length > 0 ? (
                      <div className="space-y-3 max-h-96 overflow-y-auto_ pr-2">
                        {selectedSupplierInvoices.slice(0, 10).map((invoice, index) => ( // Display top 10 recent
                          <React.Fragment key={invoice.id}>
                            <div className="flex items-start space-x-3">
                              <div className="flex flex-col items-center">
                                <div className={cn("mt-1 h-3 w-3 rounded-full", invoice.status === 'completed' ? 'bg-green-500' : invoice.status === 'error' ? 'bg-destructive' : 'bg-yellow-500')} />
                                {index < selectedSupplierInvoices.slice(0, 10).length - 1 && <div className="h-full w-px bg-border" />}
                              </div>
                              <div className="pb-3 flex-1">
                                <p className="text-xs text-muted-foreground">{formatDate(invoice.uploadTime as string, 'PPp')}</p>
                                <p className="text-sm font-medium">
                                  <Button variant="link" className="p-0 h-auto text-sm" onClick={() => navigateToInvoiceDetails(invoice.id)}>
                                    {invoice.fileName} {invoice.invoiceNumber && `(#${invoice.invoiceNumber})`}
                                  </Button>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Total: {formatCurrency(invoice.totalAmount)} - Status: {renderStatusBadge(invoice.status)}
                                </p>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">No invoices found for this supplier.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
          <SheetFooter className="p-4 sm:p-6 border-t shrink-0">
            <SheetClose asChild>
              <Button variant="outline">Close</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
