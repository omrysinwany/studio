
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, Filter, ChevronDown, Loader2, FileText, CheckCircle, XCircle, Clock, Loader, AlertCircle, Eye, Download } from 'lucide-react'; // Added Eye, Download
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { InvoiceHistoryItem, getInvoices } from '@/services/backend';
import { Badge } from '@/components/ui/badge';

// Helper function to safely format numbers
// - decimals: Number of decimal places (default 2)
// - useGrouping: Whether to use thousand separators (default false for inputs, true for display)
const formatNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = false } = options || {}; // Default: 2 decimals, no grouping for inputs

    if (value === null || value === undefined || isNaN(value)) {
        // Return a formatted zero based on options
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping, // Use grouping based on option
        });
    }

    return value.toLocaleString(undefined, { // Use browser's locale for formatting
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping, // Use grouping based on option
    });
};


// Assume backend provides suppliers for filtering (or derive from fetched data) - Kept for UI demo
const MOCK_SUPPLIERS = ['Acme Corp', 'Beta Inc', 'Delta Co', 'Epsilon Supply'];

type SortKey = keyof InvoiceHistoryItem | '';
type SortDirection = 'asc' | 'desc';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof InvoiceHistoryItem | 'actions', boolean>>({
    id: false, // Keep ID internal if not needed for display but useful for export/keys
    fileName: true,
    uploadTime: true,
    status: true,
    invoiceNumber: true,
    supplier: true,
    totalAmount: true,
    errorMessage: false, // Keep hidden by default
    actions: true,
  });
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<InvoiceHistoryItem['status'] | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey>('uploadTime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const router = useRouter();
  const { toast } = useToast();


   // Function to fetch invoice data
    const fetchInvoices = useCallback(async () => {
      setIsLoading(true);
      try {
        console.log("Fetching invoices from backend...");
        let fetchedData = await getInvoices();
        console.log("Fetched invoices:", fetchedData);

        // Backend service now handles date conversion.

        // Apply client-side filtering (can be moved to backend later)
        let filteredData = fetchedData;
        if (filterSupplier) {
           filteredData = filteredData.filter(inv => inv.supplier === filterSupplier);
        }
        if (filterStatus) {
           filteredData = filteredData.filter(inv => inv.status === filterStatus);
        }
         if (dateRange?.from) {
             // Ensure date comparison includes the start date
            const startDate = new Date(dateRange.from);
            startDate.setHours(0, 0, 0, 0); // Set to start of the day
            filteredData = filteredData.filter(inv => new Date(inv.uploadTime) >= startDate);
         }
         if (dateRange?.to) {
            const endDate = new Date(dateRange.to);
            endDate.setHours(23, 59, 59, 999); // Set to end of the day
            filteredData = filteredData.filter(inv => new Date(inv.uploadTime) <= endDate);
         }

        setInvoices(filteredData);

      } catch (error) {
        console.error("Failed to fetch invoices:", error);
        toast({
          title: "Error Fetching Invoices",
          description: "Could not load invoice data. Please try again later.",
          variant: "destructive",
        });
        setInvoices([]);
      } finally {
        setIsLoading(false);
      }
    }, [filterSupplier, filterStatus, dateRange, toast]); // Dependencies for re-fetching


   // Fetch invoice data on mount and when filters change
   useEffect(() => {
     fetchInvoices();
   }, [fetchInvoices]); // fetchInvoices includes all its own dependencies


  const handleSort = (key: SortKey) => {
    if (!key) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedInvoices = useMemo(() => {
    let result = [...invoices];

    // Search filtering
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(item =>
        item.fileName.toLowerCase().includes(lowerSearchTerm) ||
        (item.invoiceNumber && item.invoiceNumber.toLowerCase().includes(lowerSearchTerm)) ||
        (item.supplier && item.supplier.toLowerCase().includes(lowerSearchTerm))
      );
    }

    // Sorting
    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey as keyof InvoiceHistoryItem]; // Use assertion here
        const valB = b[sortKey as keyof InvoiceHistoryItem]; // Use assertion here

        let comparison = 0;
        if (sortKey === 'uploadTime') {
            const dateA = valA instanceof Date ? valA.getTime() : new Date(valA as string).getTime();
            const dateB = valB instanceof Date ? valB.getTime() : new Date(valB as string).getTime();
            comparison = dateA - dateB;
        } else if (typeof valA === 'number' && typeof valB === 'number') {
          comparison = valA - valB;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          comparison = valA.localeCompare(valB);
        } else {
           if (valA == null && valB != null) comparison = 1;
           else if (valA != null && valB == null) comparison = -1;
           else comparison = 0;
        }
        return sortDirection === 'asc' ? comparison : comparison * -1;
      });
    }

    return result;
  }, [invoices, searchTerm, sortKey, sortDirection]);


   // Column definition including internal 'id'
   const columnDefinitions: { key: keyof InvoiceHistoryItem | 'actions'; label: string; sortable: boolean, className?: string }[] = [
      { key: 'id', label: 'ID', sortable: true }, // Keep ID for potential export
      { key: 'fileName', label: 'File Name', sortable: true, className: 'min-w-[200px]' },
      { key: 'uploadTime', label: 'Upload Date', sortable: true, className: 'min-w-[150px]' },
      { key: 'status', label: 'Status', sortable: true, className: 'min-w-[120px]' },
      { key: 'invoiceNumber', label: 'Invoice #', sortable: true, className: 'min-w-[120px]' },
      { key: 'supplier', label: 'Supplier', sortable: true, className: 'min-w-[150px]' },
      { key: 'totalAmount', label: 'Total Amount (₪)', sortable: true, className: 'text-right min-w-[120px]' },
      { key: 'errorMessage', label: 'Error Message', sortable: false, className: 'text-xs text-destructive max-w-xs truncate' }, // Add definition for error message
      { key: 'actions', label: 'Actions', sortable: false, className: 'text-right' }
   ];

    // Filter columns for header display based on visibility state
    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key]);

   // Format date for display
   const formatDate = (date: Date | string | undefined) => {
     if (!date) return 'N/A';
     try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        // Check if date is valid before formatting
        if (isNaN(dateObj.getTime())) {
          return 'Invalid Date';
        }
        return dateObj.toLocaleString(); // Date and time
     } catch (e) {
       console.error("Error formatting date:", e, "Input:", date);
       return 'Invalid Date';
     }
   };

   const toggleColumnVisibility = (key: keyof InvoiceHistoryItem | 'actions') => {
       setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
   };


  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  const renderStatusBadge = (status: InvoiceHistoryItem['status']) => {
     let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default';
     let className = '';
     let icon = null;

     switch (status) {
         case 'completed':
             variant = 'secondary';
             className = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100/80';
             icon = <CheckCircle className="mr-1 h-3 w-3" />;
             break;
         case 'processing':
              variant = 'secondary';
             className = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse hover:bg-blue-100/80';
             icon = <Loader className="mr-1 h-3 w-3 animate-spin" />;
             break;
         case 'pending':
              variant = 'secondary';
             className = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80';
             icon = <Clock className="mr-1 h-3 w-3" />;
             break;
         case 'error':
             variant = 'destructive';
             icon = <XCircle className="mr-1 h-3 w-3" />;
             break;
         default:
             variant = 'outline';
             icon = null;
             break;
     }

     return (
        <Badge variant={variant} className={cn("text-xs font-medium", className)}>
            {icon}
            {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
     );
  };

    // --- CSV Export ---
    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
         // Format date values specifically
         if (value instanceof Date) {
            try {
                return value.toISOString(); // Use ISO format for consistency
            } catch {
                return 'Invalid Date';
            }
         }
         // Format numbers to two decimal places if applicable (no grouping for CSV)
         if (typeof value === 'number') {
              // Use the helper function for consistent formatting
             return formatNumber(value, { decimals: 2, useGrouping: false });
         }
        let stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          stringValue = stringValue.replace(/"/g, '""');
          return `"${stringValue}"`;
        }
        return stringValue;
      };

    const handleExportInvoices = () => {
        if (filteredAndSortedInvoices.length === 0) {
            toast({ title: "No Data", description: "There is no invoice data to export." });
            return;
        }

        // Define columns to export
        const exportColumns: (keyof InvoiceHistoryItem)[] = [
            'id', 'fileName', 'uploadTime', 'status', 'invoiceNumber', 'supplier', 'totalAmount', 'errorMessage'
        ];

        const headers = exportColumns
            .map(key => columnDefinitions.find(col => col.key === key)?.label || key) // Get labels
            .map(escapeCsvValue)
            .join(',');

        const rows = filteredAndSortedInvoices.map(item => {
            return exportColumns
                .map(key => escapeCsvValue(item[key]))
                .join(',');
        });

        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', 'invoices_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({ title: "Export Started", description: "Your invoice data is being downloaded as CSV." });
    };
    // --- End CSV Export ---

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary flex items-center">
            <FileText className="mr-2 h-6 w-6" /> Uploaded Invoices
          </CardTitle>
          <CardDescription>View and manage your processed invoices and delivery notes.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Toolbar */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 flex-wrap">
            <div className="relative w-full md:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search file, invoice #, supplier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                aria-label="Search invoices"
              />
            </div>
            <div className="flex gap-2 flex-wrap justify-center md:justify-end">
                {/* Date Range Filter */}
                 <Popover>
                   <PopoverTrigger asChild>
                     <Button
                       id="invoiceDate"
                       variant={"outline"}
                       className={cn(
                         "w-[260px] justify-start text-left font-normal",
                         !dateRange && "text-muted-foreground"
                       )}
                       aria-label="Select date range for filtering invoices"
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
                         <span>Filter by Upload Date</span>
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
                     {dateRange && (
                        <div className="p-2 border-t flex justify-end">
                             <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Clear</Button>
                        </div>
                     )}
                   </PopoverContent>
                 </Popover>

              {/* Supplier Filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label={`Filter by supplier. Current filter: ${filterSupplier || 'All Suppliers'}`}>
                    <Filter className="mr-2 h-4 w-4" />
                    {filterSupplier || 'Supplier'}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Filter by Supplier</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={!filterSupplier}
                    onCheckedChange={() => setFilterSupplier('')}
                  >
                    All Suppliers
                  </DropdownMenuCheckboxItem>
                  {/* Dynamically populate suppliers from data if needed */}
                  {MOCK_SUPPLIERS.map((supplier) => (
                    <DropdownMenuCheckboxItem
                      key={supplier}
                      checked={filterSupplier === supplier}
                      onCheckedChange={() => setFilterSupplier(supplier)}
                    >
                      {supplier}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Status Filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="outline" aria-label={`Filter by status. Current filter: ${filterStatus ? filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1) : 'All Statuses'}`}>
                    <Filter className="mr-2 h-4 w-4" />
                    {filterStatus ? filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1) : 'Status'}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={!filterStatus} onCheckedChange={() => setFilterStatus('')}>All Statuses</DropdownMenuCheckboxItem>
                  {(['completed', 'processing', 'pending', 'error'] as InvoiceHistoryItem['status'][]).map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={filterStatus === status}
                      onCheckedChange={() => setFilterStatus(status)}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Column Visibility Toggle */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label="Toggle column visibility">
                    <Eye className="mr-2 h-4 w-4" /> View
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                   {/* Map over definitions that should be toggleable */}
                  {columnDefinitions.filter(h => h.key !== 'actions' && h.key !== 'id' && h.key !== 'errorMessage').map((header) => (
                    <DropdownMenuCheckboxItem
                      key={header.key}
                      className="capitalize"
                      checked={visibleColumns[header.key]}
                      onCheckedChange={() => toggleColumnVisibility(header.key)}
                    >
                      {header.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {/* Option to toggle error message column separately */}
                  <DropdownMenuCheckboxItem
                      key="errorMessage"
                      className="capitalize"
                      checked={visibleColumns.errorMessage}
                      onCheckedChange={() => toggleColumnVisibility('errorMessage')}
                    >
                      {columnDefinitions.find(h => h.key === 'errorMessage')?.label || 'Error Message'}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

               {/* Export Button */}
               <Button variant="outline" onClick={handleExportInvoices}>
                 <Download className="mr-2 h-4 w-4" /> Export CSV
               </Button>
            </div>
          </div>

          {/* Invoices Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                   {/* Use filtered visibleColumnHeaders for rendering */}
                  {visibleColumnHeaders.map((header) => (
                    <TableHead
                      key={header.key}
                      className={cn(header.className, header.sortable && "cursor-pointer hover:bg-muted/50")}
                      onClick={() => header.sortable && handleSort(header.key as SortKey)}
                      aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    >
                      <div className="flex items-center gap-1">
                         {header.label}
                         {header.sortable && sortKey === header.key && (
                            <span className="text-xs" aria-hidden="true">
                               {sortDirection === 'asc' ? '▲' : '▼'}
                            </span>
                         )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">
                      <div className="flex justify-center items-center">
                         <Loader2 className="h-6 w-6 animate-spin text-primary" />
                         <span className="ml-2">Loading invoices...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredAndSortedInvoices.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">
                       No invoices found matching your criteria.
                     </TableCell>
                  </TableRow>
                ) : (
                  filteredAndSortedInvoices.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/50" data-testid={`invoice-item-${item.id}`}>
                       {/* Render cells based on visibility state */}
                       {visibleColumns.fileName && <TableCell className="font-medium truncate max-w-xs">{item.fileName}</TableCell>}
                       {visibleColumns.uploadTime && <TableCell>{formatDate(item.uploadTime)}</TableCell>}
                       {visibleColumns.status && (
                         <TableCell>
                            {renderStatusBadge(item.status)}
                         </TableCell>
                       )}
                       {visibleColumns.invoiceNumber && <TableCell>{item.invoiceNumber || '-'}</TableCell>}
                       {visibleColumns.supplier && <TableCell>{item.supplier || '-'}</TableCell>}
                       {visibleColumns.totalAmount && (
                         <TableCell className="text-right">
                             {/* Use formatNumber helper for totalAmount display with grouping */}
                            {item.totalAmount !== undefined && item.totalAmount !== null ? `₪${formatNumber(item.totalAmount, { useGrouping: true })}` : '-'}
                         </TableCell>
                       )}
                       {visibleColumns.errorMessage && (
                         <TableCell className={cn(columnDefinitions.find(h => h.key === 'errorMessage')?.className)}>
                             {item.status === 'error' ? item.errorMessage : '-'}
                         </TableCell>
                       )}
                        {/* Actions Cell */}
                        {visibleColumns.actions && (
                         <TableCell className="text-right">
                           {item.status === 'error' && item.errorMessage && (
                             <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80" title={item.errorMessage} aria-label="View error details">
                               <AlertCircle className="h-4 w-4" />
                             </Button>
                           )}
                            {/* Potential future action */}
                           {/* <Button variant="ghost" size="sm" onClick={() => router.push(`/invoices/${item.id}`)} aria-label={`View details for invoice ${item.invoiceNumber || item.fileName}`}>Details</Button> */}
                         </TableCell>
                        )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {/* TODO: Add Pagination if needed */}
        </CardContent>
      </Card>
    </div>
  );
}
