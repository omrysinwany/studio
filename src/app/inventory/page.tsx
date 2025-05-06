'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button'; // Import buttonVariants
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
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'; // Added Download, Trash2, Pagination icons
import { useRouter, useSearchParams, usePathname } from 'next/navigation'; // Import usePathname
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Product, getProductsService, clearInventory as clearInventoryService } from '@/services/backend'; // Corrected import and added clearInventory
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"; // Import AlertDialog


const ITEMS_PER_PAGE = 10; // Number of items per page

type SortKey = keyof Product | '';
type SortDirection = 'asc' | 'desc';

// Helper function to safely format numbers for display
const formatDisplayNumber = (
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


export default function InventoryPage() {
  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false); // State for delete operation
  const [searchTerm, setSearchTerm] = useState('');
  // Updated default visible columns
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'id' , boolean>>({
    id: false,
    description: true,
    catalogNumber: false, // Hide catalog # by default
    quantity: true,
    unitPrice: true,
    lineTotal: false, // Hide line total by default
    actions: true, // Keep actions visible
  });
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('description');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1); // State for pagination
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname(); // Get pathname
  const { toast } = useToast();
  const shouldRefresh = searchParams.get('refresh');
  const initialFilter = searchParams.get('filter');


   // Function to fetch inventory data
    const fetchInventory = useCallback(async () => {
      setIsLoading(true);
      try {
        console.log("Fetching inventory data...");
        const data = await getProductsService(); // Use corrected function name
        console.log("Fetched inventory data:", data);
        // Ensure lineTotal is calculated correctly when fetching
        const inventoryWithCorrectTotals = data.map(item => ({
             ...item,
             lineTotal: parseFloat(((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(2))
        }));
        setInventory(inventoryWithCorrectTotals);
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
        toast({
          title: "Error Fetching Inventory",
          description: "Could not load inventory data. Please try again later.",
          variant: "destructive",
        });
        setInventory([]);
      } finally {
        setIsLoading(false);
      }
    }, [toast]); // Include toast in dependencies


   // Fetch inventory data on mount and when refresh param changes
   useEffect(() => {
     fetchInventory();

     if (initialFilter === 'low' && filterStockLevel === 'all') {
       setFilterStockLevel('low');
     }

     // Remove refresh param after fetching to prevent re-fetching if other state changes
     if (shouldRefresh) {
        const current = new URLSearchParams(Array.from(searchParams.entries())); // Get current params
        current.delete('refresh'); // Remove the refresh param
        const search = current.toString();
        const query = search ? `?${search}` : "";
        router.replace(`${pathname}${query}`, { scroll: false }); // Update URL without refresh param
     }
   }, [fetchInventory, shouldRefresh, initialFilter, filterStockLevel, router, searchParams, pathname]); // Added pathname to dependencies


  const handleSort = (key: SortKey) => {
     if (!key) return;
     if (sortKey === key) {
       setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
     } else {
       setSortKey(key);
       setSortDirection('asc');
     }
     setCurrentPage(1); // Reset to first page on sort
   };


   const filteredAndSortedInventory = useMemo(() => {
     let result = [...inventory];

     // Filtering
     if (searchTerm) {
       const lowerSearchTerm = searchTerm.toLowerCase();
       result = result.filter(item =>
         (item.description?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.catalogNumber?.toLowerCase() || '').includes(lowerSearchTerm)
       );
     }
      if (filterStockLevel === 'low') {
        result = result.filter(item => item.quantity > 0 && item.quantity <= 10);
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => item.quantity > 0);
      } else if (filterStockLevel === 'out') {
        result = result.filter(item => item.quantity === 0);
      }


     // Sorting
      if (sortKey) {
        result.sort((a, b) => {
          const valA = a[sortKey as keyof Product];
          const valB = b[sortKey as keyof Product];

           let comparison = 0;
           if (typeof valA === 'number' && typeof valB === 'number') {
             comparison = valA - valB;
           } else if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB);
           } else {
              // Handle potential null/undefined values during sorting
              if (valA == null && valB != null) comparison = -1; // nulls first
              else if (valA != null && valB == null) comparison = 1; // nulls first
              else comparison = 0; // both null or undefined
           }

          return sortDirection === 'asc' ? comparison : comparison * -1;
        });
      }

     // Recalculate lineTotal for display consistency based on current quantity and unitPrice
     result = result.map(item => {
         const quantity = Number(item.quantity) || 0;
         const unitPrice = Number(item.unitPrice) || 0;
         return {
            ...item,
            // Ensure internal data remains numeric, but recalculate lineTotal
            quantity: parseFloat(quantity.toFixed(2)),
            unitPrice: parseFloat(unitPrice.toFixed(2)),
            lineTotal: parseFloat((quantity * unitPrice).toFixed(2)) // Recalculate here
         };
     });

     return result;
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection]);

    // Pagination Calculations
    const totalItems = filteredAndSortedInventory.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const paginatedInventory = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        return filteredAndSortedInventory.slice(startIndex, endIndex);
    }, [filteredAndSortedInventory, currentPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    const toggleColumnVisibility = (key: keyof Product | 'actions' | 'id') => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Column definition including internal 'id' - Moved Actions to the beginning
    const columnDefinitions: { key: keyof Product | 'actions' | 'id'; label: string; sortable: boolean, className?: string, mobileHidden?: boolean }[] = [
        { key: 'actions', label: 'Actions', sortable: false, className: 'text-left' }, // Actions first, text-left
        { key: 'id', label: 'ID', sortable: true }, // Keep ID for potential export
        { key: 'description', label: 'Product Description', sortable: true, className: 'min-w-[150px] sm:min-w-[200px]' },
        { key: 'catalogNumber', label: 'Catalog #', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true }, // Hide catalog on mobile
        { key: 'quantity', label: 'Qty', sortable: true, className: 'text-right min-w-[60px] sm:min-w-[100px]' }, // Shorten label
        { key: 'unitPrice', label: 'Unit Price (₪)', sortable: true, className: 'text-right min-w-[80px] sm:min-w-[100px]', mobileHidden: false }, // Show unit price by default
        { key: 'lineTotal', label: 'Total (₪)', sortable: true, className: 'text-right min-w-[80px] sm:min-w-[100px]' }, // Shorten label
    ];

    // Filter columns for header display based on visibility state AND mobileHidden flag
    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key]);


    // --- CSV Export ---
    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
        // Format numbers to two decimal places if applicable
        if (typeof value === 'number') {
            // Use the helper function for consistent formatting (no grouping for CSV)
            return formatDisplayNumber(value, { decimals: 2, useGrouping: false });
        }
        let stringValue = String(value);
        // If the value contains a comma, double quote, or newline, enclose it in double quotes
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          // Escape existing double quotes by doubling them
          stringValue = stringValue.replace(/"/g, '""');
          return `"${stringValue}"`;
        }
        return stringValue;
      };

    const handleExportInventory = () => {
        if (filteredAndSortedInventory.length === 0) {
            toast({ title: "No Data", description: "There is no inventory data to export." });
            return;
        }

        // Define columns to export (can be different from visible columns if needed)
        const exportColumns: (keyof Product | 'id')[] = [
            'id', 'catalogNumber', 'description', 'quantity', 'unitPrice', 'lineTotal'
        ];

        const headers = exportColumns
            .map(key => columnDefinitions.find(col => col.key === key)?.label || key) // Get labels
            .map(escapeCsvValue)
            .join(',');

        const rows = filteredAndSortedInventory.map(item => {
            return exportColumns
                .map(key => escapeCsvValue(item[key as keyof Product]))
                .join(',');
        });

        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', 'inventory_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({ title: "Export Started", description: "Your inventory data is being downloaded as CSV." });
    };
    // --- End CSV Export ---

    // --- Delete All Inventory ---
    const handleDeleteAllInventory = async () => {
        setIsDeleting(true);
        try {
            await clearInventoryService(); // Call backend service
            await fetchInventory(); // Refetch data
            setCurrentPage(1); // Reset to page 1
            toast({
                title: "Inventory Cleared",
                description: "All inventory items have been deleted.",
            });
        } catch (error) {
            console.error("Failed to clear inventory:", error);
            toast({
                title: "Error Clearing Inventory",
                description: "Could not delete inventory data. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };
    // --- End Delete All Inventory ---


    if (isLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <Card className="shadow-md bg-card text-card-foreground">
         <CardHeader>
           <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
              <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> Inventory Overview
           </CardTitle>
           <CardDescription>Browse, search, and manage your inventory items.</CardDescription>
         </CardHeader>
         <CardContent>
           {/* Toolbar */}
           <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6 flex-wrap">
              <div className="relative w-full md:max-w-xs lg:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..." // Shorten placeholder
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} // Reset page on search
                  className="pl-10"
                  aria-label="Search inventory"
                />
              </div>
               <div className="flex gap-2 flex-wrap justify-start md:justify-end">
                 {/* Stock Level Filter */}
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="flex-1 md:flex-initial"> {/* Take full width on mobile */}
                      <Filter className="mr-2 h-4 w-4" />
                       {filterStockLevel === 'low' ? 'Low Stock' :
                        filterStockLevel === 'inStock' ? 'In Stock' :
                        filterStockLevel === 'out' ? 'Out of Stock' :
                        'Stock'} {/* Shorten Label */}
                      <ChevronDown className="ml-auto md:ml-2 h-4 w-4" /> {/* Move chevron */}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuLabel>Filter by Stock Level</DropdownMenuLabel>
                     <DropdownMenuSeparator />
                     <DropdownMenuCheckboxItem
                         checked={filterStockLevel === 'all'}
                         onCheckedChange={() => { setFilterStockLevel('all'); setCurrentPage(1); }} // Reset page on filter
                       >
                         All
                     </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                          checked={filterStockLevel === 'inStock'}
                          onCheckedChange={() => { setFilterStockLevel('inStock'); setCurrentPage(1); }}
                        >
                          In Stock
                      </DropdownMenuCheckboxItem>
                     <DropdownMenuCheckboxItem
                       checked={filterStockLevel === 'low'}
                       onCheckedChange={() => { setFilterStockLevel('low'); setCurrentPage(1); }}
                     >
                       Low Stock (1-10)
                     </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem
                       checked={filterStockLevel === 'out'}
                       onCheckedChange={() => { setFilterStockLevel('out'); setCurrentPage(1); }}
                     >
                       Out of Stock (0)
                     </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>


                 {/* Column Visibility Toggle */}
                 <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                     <Button variant="outline" className="flex-1 md:flex-initial"> {/* Take full width on mobile */}
                       <Eye className="mr-2 h-4 w-4" /> View
                       <ChevronDown className="ml-auto md:ml-2 h-4 w-4" /> {/* Move chevron */}
                     </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                     {/* Map over definitions that should be toggleable */}
                     {columnDefinitions.filter(h => h.key !== 'actions' && h.key !== 'id').map((header) => (
                       <DropdownMenuCheckboxItem
                         key={header.key}
                         className="capitalize"
                         checked={visibleColumns[header.key]}
                         onCheckedChange={() => toggleColumnVisibility(header.key)}
                       >
                         {header.label}
                       </DropdownMenuCheckboxItem>
                     ))}
                   </DropdownMenuContent>
                 </DropdownMenu>

                  {/* Export Button */}
                  <Button variant="outline" onClick={handleExportInventory} className="flex-1 md:flex-initial"> {/* Take full width on mobile */}
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>

                    {/* Delete All Button */}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting} className="flex-1 md:flex-initial"> {/* Take full width on mobile */}
                                {isDeleting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Trash2 className="mr-2 h-4 w-4" />
                                )}
                                Delete All
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete all inventory items.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAllInventory} className={cn(buttonVariants({ variant: "destructive" }))}>
                                {isDeleting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Yes, delete all
                            </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

               </div>
           </div>

           {/* Inventory Table */}
           <div className="overflow-x-auto">
             <Table>
               <TableHeader>
                 <TableRow>
                    {/* Use filtered visibleColumnHeaders for rendering */}
                    {visibleColumnHeaders.map((header) => (
                         <TableHead
                            key={header.key}
                            className={cn(
                                header.className,
                                header.sortable && "cursor-pointer hover:bg-muted/50",
                                // Apply mobileHidden classes conditionally based on screen size
                                header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell',
                                'px-2 sm:px-4 py-2' // Reduce padding for all cells
                            )}
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
                 {paginatedInventory.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2"> {/* Reduce padding */}
                       No inventory items found matching your criteria.
                     </TableCell>
                   </TableRow>
                 ) : (
                   paginatedInventory.map((item) => (
                     <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50" data-testid={`inventory-item-${item.id}`}>
                       {/* Render cells based on visibility state and mobileHidden */}
                        {visibleColumns.actions && (
                         <TableCell className="text-left px-2 sm:px-4 py-2"> {/* Changed to text-left */}
                           <Button
                             variant="ghost"
                             size="sm"
                             onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                             disabled={!item.id}
                             aria-label={`View details for ${item.description}`}
                             className="h-8 px-2" // Adjust button size for mobile
                           >
                             <Eye className="mr-1 h-4 w-4" /> <span className="hidden sm:inline">Details</span> {/* Hide text on mobile */}
                           </Button>
                         </TableCell>
                        )}
                        {visibleColumns.description && <TableCell className="font-medium px-2 sm:px-4 py-2 truncate max-w-[150px] sm:max-w-none">{item.description || 'N/A'}</TableCell>}
                        {visibleColumns.catalogNumber && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'catalogNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.catalogNumber || 'N/A'}</TableCell>}
                        {visibleColumns.quantity && (
                          <TableCell className="text-right px-2 sm:px-4 py-2">
                             {/* Use formatDisplayNumber helper for quantity display as integer with grouping */}
                            <span>{formatDisplayNumber(item.quantity, { decimals: 0, useGrouping: true })}</span>
                            {item.quantity === 0 && (
                              <Badge variant="destructive" className="ml-1 sm:ml-2 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">Out</Badge>
                            )}
                            {item.quantity > 0 && item.quantity <= 10 && (
                              <Badge variant="secondary" className="ml-1 sm:ml-2 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">Low</Badge>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.unitPrice && <TableCell className={cn('text-right px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'unitPrice')?.mobileHidden && 'hidden sm:table-cell')}>₪{formatDisplayNumber(item.unitPrice, { decimals: 2, useGrouping: true })}</TableCell>}
                        {visibleColumns.lineTotal && <TableCell className="text-right px-2 sm:px-4 py-2">₪{formatDisplayNumber(item.lineTotal, { decimals: 2, useGrouping: true })}</TableCell>}
                     </TableRow>
                   ))
                 )}
               </TableBody>
             </Table>
           </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between sm:justify-end space-x-2 py-4">
                     <span className="text-sm text-muted-foreground hidden sm:block">
                        Page {currentPage} of {totalPages} ({totalItems} items)
                    </span>
                     <div className="flex space-x-1">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="h-8 px-2" // Smaller buttons for mobile
                        >
                            <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Previous</span>
                        </Button>
                        <span className="text-sm text-muted-foreground sm:hidden px-2 flex items-center">
                            {currentPage}/{totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                             className="h-8 px-2" // Smaller buttons for mobile
                        >
                            <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
         </CardContent>
       </Card>
    </div>
  );
}
