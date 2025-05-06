
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from "@/lib/utils";
import { Product, getProductsService, clearInventoryService } from '@/services/backend';
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
} from "@/components/ui/alert-dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";


const ITEMS_PER_PAGE = 10;

type SortKey = keyof Product | '';
type SortDirection = 'asc' | 'desc';

const formatDisplayNumber = (
    value: number | undefined | null,
    options?: { decimals?: number, useGrouping?: boolean }
): string => {
    const { decimals = 2, useGrouping = true } = options || {};

    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: useGrouping,
        });
    }

    return value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: useGrouping,
    });
};

const formatIntegerQuantity = (
    value: number | undefined | null
): string => {
    return formatDisplayNumber(value, { decimals: 0, useGrouping: true });
};


export default function InventoryPage() {
  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'id' , boolean>>({
    actions: true,
    id: false,
    description: false,
    shortName: true,
    catalogNumber: false,
    barcode: false,
    quantity: true,
    unitPrice: true,
    lineTotal: false,
    minStockLevel: false, // Hidden by default
    maxStockLevel: false, // Hidden by default
  });
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out' | 'over'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('shortName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { toast } = useToast();
  const shouldRefresh = searchParams.get('refresh');
  const initialFilter = searchParams.get('filter');


    const fetchInventory = useCallback(async () => {
      setIsLoading(true);
      try {
        console.log("Fetching inventory data...");
        const data = await getProductsService();
        console.log("Fetched inventory data:", data);
        const inventoryWithCorrectTotals = data.map(item => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unitPrice) || 0;
             return {
                 ...item,
                 quantity: quantity,
                 unitPrice: unitPrice,
                 lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
                 minStockLevel: item.minStockLevel,
                 maxStockLevel: item.maxStockLevel,
             };
        });
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
    }, [toast]);


   useEffect(() => {
     fetchInventory();

     if (initialFilter === 'low' && filterStockLevel === 'all') {
       setFilterStockLevel('low');
     }

     if (shouldRefresh) {
        const current = new URLSearchParams(Array.from(searchParams.entries()));
        current.delete('refresh');
        const search = current.toString();
        const query = search ? `?${search}` : "";
        router.replace(`${pathname}${query}`, { scroll: false });
     }
   }, [fetchInventory, shouldRefresh, initialFilter, filterStockLevel, router, searchParams, pathname]);


  const handleSort = (key: SortKey) => {
     if (!key) return;
     if (sortKey === key) {
       setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
     } else {
       setSortKey(key);
       setSortDirection('asc');
     }
     setCurrentPage(1);
   };


   const filteredAndSortedInventory = useMemo(() => {
     let result = [...inventory];

     if (searchTerm) {
       const lowerSearchTerm = searchTerm.toLowerCase();
       result = result.filter(item =>
         (item.description?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.shortName?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.catalogNumber?.toLowerCase() || '').includes(lowerSearchTerm) ||
         (item.barcode?.toLowerCase() || '').includes(lowerSearchTerm)
       );
     }
      if (filterStockLevel === 'low') {
        result = result.filter(item => item.quantity > 0 && item.quantity <= (item.minStockLevel || 10));
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => item.quantity > 0);
      } else if (filterStockLevel === 'out') {
        result = result.filter(item => item.quantity === 0);
      } else if (filterStockLevel === 'over') {
        result = result.filter(item => item.maxStockLevel !== undefined && item.quantity > item.maxStockLevel);
      }


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
              if (valA == null && valB != null) comparison = -1;
              else if (valA != null && valB == null) comparison = 1;
              else comparison = 0;
           }

          return sortDirection === 'asc' ? comparison : comparison * -1;
        });
      }

     result = result.map(item => {
         const quantity = Number(item.quantity) || 0;
         const unitPrice = Number(item.unitPrice) || 0;
         return {
            ...item,
             quantity: quantity,
             unitPrice: unitPrice,
            lineTotal: parseFloat((quantity * unitPrice).toFixed(2))
         };
     });

     return result;
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection]);

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

    const columnDefinitions: { key: keyof Product | 'actions' | 'id'; label: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string }[] = [
        { key: 'actions', label: 'Actions', sortable: false, className: 'text-center sticky left-0 bg-card z-10 px-2 sm:px-4', headerClassName: 'text-center sticky left-0 bg-card z-10' },
        { key: 'shortName', label: 'Product', sortable: true, className: 'min-w-[100px] sm:min-w-[150px]', headerClassName: 'text-center' },
        { key: 'description', label: 'Description', sortable: true, className: 'min-w-[150px] sm:min-w-[200px]', mobileHidden: true, headerClassName: 'text-center' },
        { key: 'id', label: 'ID', sortable: true, headerClassName: 'text-center' },
        { key: 'catalogNumber', label: 'Catalog #', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true, headerClassName: 'text-center' },
        { key: 'barcode', label: 'Barcode', sortable: true, className: 'min-w-[100px] sm:min-w-[120px]', mobileHidden: true, headerClassName: 'text-center' },
        { key: 'quantity', label: 'Qty', sortable: true, className: 'text-center min-w-[60px] sm:min-w-[100px]', headerClassName: 'text-center' },
        { key: 'unitPrice', label: 'Unit Price (₪)', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px]', mobileHidden: false, headerClassName: 'text-center' },
        { key: 'lineTotal', label: 'Total (₪)', sortable: true, className: 'text-right min-w-[80px] sm:min-w-[100px]', headerClassName: 'text-center' },
        { key: 'minStockLevel', label: 'Min Stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px]', mobileHidden: true, headerClassName: 'text-center' },
        { key: 'maxStockLevel', label: 'Max Stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px]', mobileHidden: true, headerClassName: 'text-center' },
    ];

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key]);


    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
        if (typeof value === 'number') {
            return formatDisplayNumber(value, { decimals: 2, useGrouping: false });
        }
        let stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
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

        const exportColumns: (keyof Product | 'id')[] = [
            'id', 'catalogNumber', 'barcode', 'shortName', 'description', 'quantity', 'unitPrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'
        ];

        const headers = exportColumns
            .map(key => columnDefinitions.find(col => col.key === key)?.label || key)
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

    const handleDeleteAllInventory = async () => {
        setIsDeleting(true);
        try {
            await clearInventoryService();
            await fetchInventory();
            setCurrentPage(1);
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
           <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6 flex-wrap">
              <div className="relative w-full md:max-w-xs lg:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  className="pl-10"
                  aria-label="Search inventory"
                />
              </div>
               <div className="flex gap-2 flex-wrap justify-start md:justify-end">
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="flex-1 md:flex-initial">
                      <Filter className="mr-2 h-4 w-4" />
                       {filterStockLevel === 'low' ? 'Low Stock' :
                        filterStockLevel === 'inStock' ? 'In Stock' :
                        filterStockLevel === 'out' ? 'Out of Stock' :
                        filterStockLevel === 'over' ? 'Over Stock' :
                        'Stock'}
                      <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     <DropdownMenuLabel>Filter by Stock Level</DropdownMenuLabel>
                     <DropdownMenuSeparator />
                     <DropdownMenuCheckboxItem
                         checked={filterStockLevel === 'all'}
                         onCheckedChange={() => { setFilterStockLevel('all'); setCurrentPage(1); }}
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
                       Low Stock
                     </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem
                       checked={filterStockLevel === 'out'}
                       onCheckedChange={() => { setFilterStockLevel('out'); setCurrentPage(1); }}
                     >
                       Out of Stock
                     </DropdownMenuCheckboxItem>
                     <DropdownMenuCheckboxItem
                       checked={filterStockLevel === 'over'}
                       onCheckedChange={() => { setFilterStockLevel('over'); setCurrentPage(1); }}
                     >
                       Over Stock
                     </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>


                 <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                     <Button variant="outline" className="flex-1 md:flex-initial">
                       <Eye className="mr-2 h-4 w-4" /> View
                       <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                     </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
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

                  <Button variant="outline" onClick={handleExportInventory} className="flex-1 md:flex-initial">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isDeleting} className="flex-1 md:flex-initial">
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
                            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAllInventory} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
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

           <div className="overflow-x-auto relative">
             <Table>
               <TableHeader>
                 <TableRow>
                    {visibleColumnHeaders.map((header) => (
                         <TableHead
                            key={header.key}
                            className={cn(
                                header.className,
                                header.headerClassName,
                                header.sortable && "cursor-pointer hover:bg-muted/50",
                                header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell',
                                'px-2 sm:px-4 py-2',
                                header.key === 'actions' && 'sticky left-0 bg-card z-10'
                            )}
                            onClick={() => header.sortable && handleSort(header.key as SortKey)}
                            aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                         >
                             <div className="flex items-center justify-center gap-1">
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
                     <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center px-2 sm:px-4 py-2">
                       No inventory items found matching your criteria.
                     </TableCell>
                   </TableRow>
                 ) : (
                   paginatedInventory.map((item) => (
                     <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50" data-testid={`inventory-item-${item.id}`}>
                        {visibleColumns.actions && (
                         <TableCell className={cn('text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2')}>
                            <div className="flex gap-1 justify-center">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                                    disabled={!item.id}
                                    aria-label={`View details for ${item.shortName || item.description}`}
                                    className="h-8 w-8 text-primary hover:text-primary/80"
                                >
                                    <Eye className="h-4 w-4" />
                                </Button>
                            </div>
                         </TableCell>
                        )}
                        {visibleColumns.shortName && (
                            <TableCell className="font-medium px-2 sm:px-4 py-2 truncate max-w-[100px] sm:max-w-[150px]">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="link" className="p-0 h-auto text-left font-medium cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground">
                                            {item.shortName || item.description?.split(' ').slice(0,3).join(' ') || 'N/A'}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent side="top" align="start" className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg">
                                        <p>{item.description || 'No description available.'}</p>
                                    </PopoverContent>
                                </Popover>
                            </TableCell>
                        )}
                         {visibleColumns.description && <TableCell className={cn('font-medium px-2 sm:px-4 py-2 truncate max-w-[150px] sm:max-w-none', columnDefinitions.find(h => h.key === 'description')?.mobileHidden && 'hidden sm:table-cell')}>{item.description || 'N/A'}</TableCell>}
                        {visibleColumns.id && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'id')?.mobileHidden && 'hidden sm:table-cell')}>{item.id || 'N/A'}</TableCell>}
                        {visibleColumns.catalogNumber && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'catalogNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.catalogNumber || 'N/A'}</TableCell>}
                         {visibleColumns.barcode && <TableCell className={cn('px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'barcode')?.mobileHidden && 'hidden sm:table-cell')}>{item.barcode || 'N/A'}</TableCell>}
                        {visibleColumns.quantity && (
                          <TableCell className="text-center px-2 sm:px-4 py-2">
                            <span>{formatIntegerQuantity(item.quantity)}</span>
                            {item.quantity === 0 && (
                              <Badge variant="destructive" className="ml-1 sm:ml-2 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">Out</Badge>
                            )}
                            {item.quantity > 0 && item.quantity <= (item.minStockLevel || 10) && (
                              <Badge variant="secondary" className="ml-1 sm:ml-2 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">Low</Badge>
                            )}
                            {item.maxStockLevel !== undefined && item.quantity > item.maxStockLevel && (
                               <Badge variant="secondary" className="ml-1 sm:ml-2 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">Over</Badge>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.unitPrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'unitPrice')?.mobileHidden && 'hidden sm:table-cell')}>₪{formatDisplayNumber(item.unitPrice, { decimals: 2, useGrouping: true })}</TableCell>}
                        {visibleColumns.lineTotal && <TableCell className="text-right px-2 sm:px-4 py-2">₪{formatDisplayNumber(item.lineTotal, { decimals: 2, useGrouping: true })}</TableCell>}
                        {visibleColumns.minStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'minStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.minStockLevel !== undefined ? formatIntegerQuantity(item.minStockLevel) : '-'}</TableCell>}
                        {visibleColumns.maxStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'maxStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.maxStockLevel !== undefined ? formatIntegerQuantity(item.maxStockLevel) : '-'}</TableCell>}
                     </TableRow>
                   ))
                 )}
               </TableBody>
             </Table>
           </div>

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
                            className="h-8 px-2"
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
                             className="h-8 px-2"
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

