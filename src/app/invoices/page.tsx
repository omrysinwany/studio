'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Search, Filter, ChevronDown, Loader2, FileText, CheckCircle, XCircle, Clock, Loader } from 'lucide-react';
import { useRouter } from 'next/navigation';
// Removed useAuth import
import { useToast } from '@/hooks/use-toast';
import { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';

// Define the structure for invoice history items (similar to upload history but potentially richer)
interface InvoiceHistoryItem {
  id: string; // Could be the same ID as upload history or a separate one
  fileName: string;
  uploadTime: Date;
  status: 'pending' | 'processing' | 'completed' | 'error';
  invoiceNumber?: string; // Extracted invoice number
  supplier?: string; // Extracted supplier
  totalAmount?: number; // Extracted total amount
  errorMessage?: string;
}

// Mock Invoice Data - Replace with actual API call fetching processed invoice records
const MOCK_INVOICES: InvoiceHistoryItem[] = [
  { id: 'inv1', fileName: 'invoice_acme_corp.pdf', uploadTime: new Date(Date.now() - 86400000 * 1), status: 'completed', invoiceNumber: 'INV-1001', supplier: 'Acme Corp', totalAmount: 1250.75 },
  { id: 'inv2', fileName: 'delivery_note_beta_inc.jpg', uploadTime: new Date(Date.now() - 86400000 * 3), status: 'completed', invoiceNumber: 'DN-0523', supplier: 'Beta Inc', totalAmount: 800.00 },
  { id: 'inv3', fileName: 'receipt_gamma_ltd.png', uploadTime: new Date(Date.now() - 86400000 * 5), status: 'error', errorMessage: 'Failed to extract totals' },
  { id: 'inv4', fileName: 'invoice_delta_co.pdf', uploadTime: new Date(Date.now() - 86400000 * 7), status: 'completed', invoiceNumber: 'INV-D-567', supplier: 'Delta Co', totalAmount: 2100.50 },
  { id: 'inv5', fileName: 'scan_epsilon_supply.jpeg', uploadTime: new Date(Date.now() - 86400000 * 10), status: 'processing' },
  // Add more mock data
];

// Assume backend provides suppliers for filtering
const MOCK_SUPPLIERS = ['Acme Corp', 'Beta Inc', 'Delta Co', 'Epsilon Supply'];

type SortKey = keyof InvoiceHistoryItem | '';
type SortDirection = 'asc' | 'desc';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof InvoiceHistoryItem, boolean>>({
    id: false,
    fileName: true,
    uploadTime: true,
    status: true,
    invoiceNumber: true,
    supplier: true,
    totalAmount: true,
    errorMessage: false, // Hide error message column by default
  });
  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<InvoiceHistoryItem['status'] | ''>('');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined); // No default range initially
  const [sortKey, setSortKey] = useState<SortKey>('uploadTime');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const router = useRouter();
  // Removed user, authLoading
  const { toast } = useToast();


   // Fetch invoice data (replace with actual API call)
   useEffect(() => {
     const fetchInvoices = async () => {
       // Removed user check
       setIsLoading(true);
       try {
         // Simulate API call delay
         await new Promise(resolve => setTimeout(resolve, 1000));
         // TODO: Replace MOCK_INVOICES with actual API call using filters:
         // const params = new URLSearchParams();
         // if (filterSupplier) params.append('supplier', filterSupplier);
         // if (filterStatus) params.append('status', filterStatus);
         // if (dateRange?.from) params.append('from', dateRange.from.toISOString());
         // if (dateRange?.to) params.append('to', dateRange.to.toISOString());
         // const response = await fetch(`/api/invoices?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` }});
         // const data = await response.json();
         // setInvoices(data.map((item: any) => ({ ...item, uploadTime: new Date(item.uploadTime) })));

         // Apply filters locally for mock data
         let filteredData = MOCK_INVOICES;
         if (filterSupplier) {
            filteredData = filteredData.filter(inv => inv.supplier === filterSupplier);
         }
         if (filterStatus) {
            filteredData = filteredData.filter(inv => inv.status === filterStatus);
         }
          if (dateRange?.from) {
             filteredData = filteredData.filter(inv => inv.uploadTime >= dateRange.from!);
          }
          if (dateRange?.to) {
             // Adjust to include the end date
             const endDate = new Date(dateRange.to);
             endDate.setHours(23, 59, 59, 999);
             filteredData = filteredData.filter(inv => inv.uploadTime <= endDate);
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
     };

     fetchInvoices(); // Fetch data directly
     // Removed authLoading and user dependencies
   }, [filterSupplier, filterStatus, dateRange, toast]);


   // Removed useEffect for auth redirection


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
        const valA = a[sortKey];
        const valB = b[sortKey];

        let comparison = 0;
        if (sortKey === 'uploadTime') {
            comparison = new Date(valA as Date).getTime() - new Date(valB as Date).getTime();
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


   const columnHeaders: { key: keyof InvoiceHistoryItem; label: string; sortable: boolean, className?: string }[] = [
      { key: 'fileName', label: 'File Name', sortable: true, className: 'min-w-[200px]' },
      { key: 'uploadTime', label: 'Upload Date', sortable: true, className: 'min-w-[150px]' },
      { key: 'status', label: 'Status', sortable: true, className: 'min-w-[100px]' },
      { key: 'invoiceNumber', label: 'Invoice #', sortable: true, className: 'min-w-[120px]' },
      { key: 'supplier', label: 'Supplier', sortable: true, className: 'min-w-[150px]' },
      { key: 'totalAmount', label: 'Total Amount', sortable: true, className: 'text-right min-w-[120px]' },
   ];


   // Format date for display
   const formatDate = (date: Date) => {
     try {
       return date.toLocaleDateString();
     } catch (e) {
       return 'Invalid Date';
     }
   };


  if (isLoading) { // Removed authLoading check
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

    // Removed !user check

  const renderStatusIcon = (status: InvoiceHistoryItem['status']) => {
    switch (status) {
        case 'completed': return <CheckCircle className="mr-1 h-3 w-3 text-green-600" />;
        case 'processing': return <Loader className="mr-1 h-3 w-3 text-blue-600 animate-spin" />;
        case 'pending': return <Clock className="mr-1 h-3 w-3 text-yellow-600" />;
        case 'error': return <XCircle className="mr-1 h-3 w-3 text-red-600" />;
        default: return null;
    }
  };

  const getStatusColorClass = (status: InvoiceHistoryItem['status']) => {
     switch (status) {
        case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse';
        case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
        case 'error': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
        default: return '';
     }
  };

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <Card className="shadow-md">
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
                        <div className="p-2 border-t">
                             <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)}>Clear</Button>
                        </div>
                     )}
                   </PopoverContent>
                 </Popover>

              {/* Supplier Filter */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
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
                  <Button variant="outline">
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
            </div>
          </div>

          {/* Invoices Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columnHeaders.filter(h => visibleColumns[h.key]).map((header) => (
                    <TableHead
                      key={header.key}
                      className={cn(header.className, header.sortable && "cursor-pointer hover:bg-muted/50")}
                      onClick={() => header.sortable && handleSort(header.key)}
                    >
                      <div className="flex items-center gap-1">
                         {header.label}
                         {header.sortable && sortKey === header.key && (
                            <span className="text-xs">
                               {sortDirection === 'asc' ? '▲' : '▼'}
                            </span>
                         )}
                      </div>
                    </TableHead>
                  ))}
                   {/* Optional: Actions Column Header */}
                   {/* <TableHead className="text-right">Actions</TableHead> */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={columnHeaders.filter(h => visibleColumns[h.key]).length + (/* Actions ? 1 : */ 0)} className="h-24 text-center">
                      <div className="flex justify-center items-center">
                         <Loader2 className="h-6 w-6 animate-spin text-primary" />
                         <span className="ml-2">Loading invoices...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredAndSortedInvoices.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={columnHeaders.filter(h => visibleColumns[h.key]).length + (/* Actions ? 1 : */ 0)} className="h-24 text-center">
                       No invoices found matching your criteria.
                     </TableCell>
                  </TableRow>
                ) : (
                  filteredAndSortedInvoices.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/50">
                       {visibleColumns.fileName && <TableCell className="font-medium truncate max-w-xs">{item.fileName}</TableCell>}
                       {visibleColumns.uploadTime && <TableCell>{formatDate(item.uploadTime)}</TableCell>}
                       {visibleColumns.status && (
                         <TableCell>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColorClass(item.status)}`}>
                                {renderStatusIcon(item.status)}
                                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                            </span>
                             {item.status === 'error' && item.errorMessage && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{item.errorMessage}</p>
                             )}
                         </TableCell>
                       )}
                       {visibleColumns.invoiceNumber && <TableCell>{item.invoiceNumber || '-'}</TableCell>}
                       {visibleColumns.supplier && <TableCell>{item.supplier || '-'}</TableCell>}
                       {visibleColumns.totalAmount && (
                         <TableCell className="text-right">
                            {item.totalAmount !== undefined ? `$${item.totalAmount.toFixed(2)}` : '-'}
                         </TableCell>
                       )}
                        {/* Optional Actions Cell */}
                        {/* <TableCell className="text-right">
                           <Button variant="ghost" size="sm" onClick={() => router.push(`/invoices/${item.id}`)}>Details</Button>
                        </TableCell> */}
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
