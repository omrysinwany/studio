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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download, Trash2, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
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
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';


const ITEMS_PER_PAGE = 10;

type SortKey = keyof Product | '';
type SortDirection = 'asc' | 'desc';

const formatDisplayNumberWithTranslation = (
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

const formatIntegerQuantityWithTranslation = (
    value: number | undefined | null,
    t: (key: string) => string
): string => {
    if (value === null || value === undefined || isNaN(value)) {
        // Use formatDisplayNumberWithTranslation for consistency, ensuring no currency symbol for plain quantity
        return formatDisplayNumberWithTranslation(0, t, { decimals: 0, useGrouping: false, currency: false });
    }
    return formatDisplayNumberWithTranslation(Math.round(value), t, { decimals: 0, useGrouping: true, currency: false });
};


export default function InventoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { toast } = useToast();
  const { t, locale } = useTranslation();

  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'id' , boolean>>({
    actions: true,
    id: false,
    shortName: true,
    description: false,
    catalogNumber: false,
    barcode: false,
    quantity: true,
    unitPrice: false,
    salePrice: true,
    lineTotal: false,
    minStockLevel: false,
    maxStockLevel: false,
  });
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out' | 'over'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('shortName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);

  const shouldRefresh = searchParams.get('refresh');
  const initialFilter = searchParams.get('filter');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);


    const fetchInventory = useCallback(async () => {
      if (!user) return;
      setIsLoading(true);
      try {
        const data = await getProductsService();
        const inventoryWithCorrectTotals = data.map(item => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unitPrice) || 0;
             return {
                 ...item,
                 quantity: quantity,
                 unitPrice: unitPrice,
                 salePrice: item.salePrice,
                 lineTotal: parseFloat((quantity * unitPrice).toFixed(2)),
                 minStockLevel: item.minStockLevel,
                 maxStockLevel: item.maxStockLevel,
             };
        });
        setInventory(inventoryWithCorrectTotals);
      } catch (error) {
        console.error("Failed to fetch inventory:", error);
        toast({
          title: t('inventory_toast_error_fetch_title'),
          description: t('inventory_toast_error_fetch_desc'),
          variant: "destructive",
        });
        setInventory([]);
      } finally {
        setIsLoading(false);
      }
    }, [toast, t, user]);


   useEffect(() => {
     if(user){
        fetchInventory();

        if (initialFilter === 'low' && filterStockLevel === 'all') {
        setFilterStockLevel('low');
        }

        if (shouldRefresh) {
            const current = new URLSearchParams(Array.from(searchParams.entries()));
            current.delete('refresh');
            const searchString = current.toString();
            const query = searchString ? `?${searchString}` : "";
            router.replace(`${pathname}${query}`, { scroll: false });
        }
     }
   }, [fetchInventory, shouldRefresh, initialFilter, filterStockLevel, router, searchParams, pathname, user]);


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
        result = result.filter(item => item.quantity > 0 && item.quantity <= (item.minStockLevel ?? 10));
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
                comparison = valA.localeCompare(valB, locale);
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
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection, locale]);

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

    const columnDefinitions: { key: keyof Product | 'actions' | 'id'; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string }[] = [
        { key: 'actions', labelKey: 'inventory_col_actions', sortable: false, className: 'text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2', headerClassName: 'text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2' },
        { key: 'shortName', labelKey: 'inventory_col_product', sortable: true, className: 'min-w-[100px] sm:min-w-[150px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'description', labelKey: 'inventory_col_description', sortable: true, className: 'min-w-[150px] sm:min-w-[200px] hidden md:table-cell px-2 sm:px-4 py-2', headerClassName: 'text-center hidden md:table-cell px-2 sm:px-4 py-2' },
        { key: 'id', labelKey: 'inventory_col_id', sortable: true, mobileHidden: true, className: 'px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'catalogNumber', labelKey: 'inventory_col_catalog', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'barcode', labelKey: 'inventory_col_barcode', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'quantity', labelKey: 'inventory_col_qty', sortable: true, className: 'text-center min-w-[60px] sm:min-w-[80px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'unitPrice', labelKey: 'inventory_col_unit_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'salePrice', labelKey: 'inventory_col_sale_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'lineTotal', labelKey: 'inventory_col_total', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'minStockLevel', labelKey: 'inventory_col_min_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'maxStockLevel', labelKey: 'inventory_col_max_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
    ];

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key]);


    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
        if (typeof value === 'number') {
            return formatDisplayNumberWithTranslation(value, t, { decimals: 2, useGrouping: false });
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
            toast({ title: t('inventory_toast_no_data_export_title'), description: t('inventory_toast_no_data_export_desc') });
            return;
        }

        const exportColumns: (keyof Product | 'id')[] = [
            'id', 'catalogNumber', 'barcode', 'shortName', 'description', 'quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel'
        ];

        const headers = exportColumns
            .map(key => t(columnDefinitions.find(col => col.key === key)?.labelKey || key))
            .map(escapeCsvValue)
            .join(',');

        const rows = filteredAndSortedInventory.map(item => {
            return exportColumns
                .map(key => escapeCsvValue(item[key as keyof Product]))
                .join(',');
        });

        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', 'inventory_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({ title: t('inventory_toast_export_started_title'), description: t('inventory_toast_export_started_desc') });
    };

    const handleDeleteAllInventory = async () => {
        setIsDeleting(true);
        try {
            await clearInventoryService();
            await fetchInventory();
            setCurrentPage(1);
            toast({
                title: t('inventory_toast_cleared_title'),
                description: t('inventory_toast_cleared_desc'),
            });
        } catch (error) {
            console.error("Failed to clear inventory:", error);
            toast({
                title: t('inventory_toast_clear_error_title'),
                description: t('inventory_toast_clear_error_desc'),
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };


    if (authLoading || isLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
       </div>
     );
   }

   if (!user) {
    return null; // Or a message encouraging login
   }

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
            <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('inventory_title')}
          </CardTitle>
          <CardDescription>{t('inventory_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 mb-6 flex-wrap">
            <div className="relative w-full md:max-w-xs lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('inventory_search_placeholder')}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-10"
                aria-label={t('inventory_search_aria')}
              />
            </div>
            <div className="flex gap-2 flex-wrap justify-start md:justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex-1 md:flex-initial">
                    <Filter className="mr-2 h-4 w-4" />
                    {filterStockLevel === 'low' ? t('inventory_filter_low') :
                      filterStockLevel === 'inStock' ? t('inventory_filter_in_stock') :
                      filterStockLevel === 'out' ? t('inventory_filter_out_of_stock') :
                      filterStockLevel === 'over' ? t('inventory_filter_over_stock') :
                      t('inventory_filter_stock_label')}
                    <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('inventory_filter_by_stock_level')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={filterStockLevel === 'all'}
                    onCheckedChange={() => { setFilterStockLevel('all'); setCurrentPage(1); }}
                  >
                    {t('inventory_filter_all')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStockLevel === 'inStock'}
                    onCheckedChange={() => { setFilterStockLevel('inStock'); setCurrentPage(1); }}
                  >
                    {t('inventory_filter_in_stock')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStockLevel === 'low'}
                    onCheckedChange={() => { setFilterStockLevel('low'); setCurrentPage(1); }}
                  >
                    {t('inventory_filter_low')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStockLevel === 'out'}
                    onCheckedChange={() => { setFilterStockLevel('out'); setCurrentPage(1); }}
                  >
                    {t('inventory_filter_out_of_stock')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filterStockLevel === 'over'}
                    onCheckedChange={() => { setFilterStockLevel('over'); setCurrentPage(1); }}
                  >
                    {t('inventory_filter_over_stock')}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex-1 md:flex-initial">
                    <Eye className="mr-2 h-4 w-4" /> {t('inventory_view_button')}
                    <ChevronDown className="ml-auto md:ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('inventory_toggle_columns_label')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {columnDefinitions.filter(h => h.key !== 'actions' && h.key !== 'id').map((header) => (
                    <DropdownMenuCheckboxItem
                      key={header.key}
                      className="capitalize"
                      checked={visibleColumns[header.key]}
                      onCheckedChange={() => toggleColumnVisibility(header.key)}
                    >
                      {t(header.labelKey)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
                        "text-center",
                        header.sortable && "cursor-pointer hover:bg-muted/50",
                        header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell'
                      )}
                      onClick={() => header.sortable && handleSort(header.key as SortKey)}
                      aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {t(header.labelKey, { currency_symbol: t('currency_symbol')})}
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
                      {t('inventory_no_items_found')}
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
                              aria-label={t('inventory_view_details_aria', { productName: item.shortName || item.description })}
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
                            <PopoverContent side="top" align="start" className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg space-y-1">
                              {item.description && (
                                <>
                                  <p className="font-semibold">{t('inventory_popover_description')}:</p>
                                  <p>{item.description}</p>
                                </>
                              )}
                              {item.catalogNumber && item.catalogNumber !== "N/A" && (
                                <>
                                  <p className="font-semibold mt-2">{t('inventory_popover_catalog')}:</p>
                                  <p>{item.catalogNumber}</p>
                                </>
                              )}
                              {item.barcode && (
                                <>
                                  <p className="font-semibold mt-2">{t('inventory_popover_barcode')}:</p>
                                  <p>{item.barcode}</p>
                                </>
                              )}
                               <>
                                <p className="font-semibold mt-2">{t('inventory_col_unit_price', { currency_symbol: t('currency_symbol')})}:</p>
                                <p>{formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true })}</p>
                               </>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                      )}
                      {visibleColumns.description && <TableCell className={cn('font-medium px-2 sm:px-4 py-2 truncate max-w-[150px] sm:max-w-none', columnDefinitions.find(h => h.key === 'description')?.mobileHidden && 'hidden sm:table-cell')}>{item.description || t('invoices_na')}</TableCell>}
                      {visibleColumns.id && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'id')?.mobileHidden && 'hidden sm:table-cell')}>{item.id || t('invoices_na')}</TableCell>}
                      {visibleColumns.catalogNumber && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'catalogNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.catalogNumber || t('invoices_na')}</TableCell>}
                      {visibleColumns.barcode && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'barcode')?.mobileHidden && 'hidden sm:table-cell')}>{item.barcode || t('invoices_na')}</TableCell>}
                      {visibleColumns.quantity && (
                        <TableCell className="text-center px-2 sm:px-4 py-2">
                          <span>{formatIntegerQuantityWithTranslation(item.quantity, t)}</span>
                          {item.quantity === 0 && (
                            <Badge variant="destructive" className="ml-1 sm:ml-2 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">{t('inventory_badge_out_of_stock')}</Badge>
                          )}
                          {item.quantity > 0 && item.minStockLevel !== undefined && item.quantity <= item.minStockLevel && (
                            <Badge variant="secondary" className="ml-1 sm:ml-2 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">{t('inventory_badge_low_stock')}</Badge>
                          )}
                          {item.maxStockLevel !== undefined && item.quantity > item.maxStockLevel && (
                            <Badge variant="secondary" className="ml-1 sm:ml-2 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 hover:bg-orange-100/80 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">{t('inventory_badge_over_stock')}</Badge>
                          )}
                        </TableCell>
                      )}
                      {visibleColumns.unitPrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'unitPrice')?.mobileHidden && 'hidden sm:table-cell')}>{formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true })}</TableCell>}
                      {visibleColumns.salePrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'salePrice')?.mobileHidden && 'hidden sm:table-cell')}>{item.salePrice !== undefined ? formatDisplayNumberWithTranslation(item.salePrice, t, { currency: true }) : '-'}</TableCell>}
                      {visibleColumns.lineTotal && <TableCell className="text-center px-2 sm:px-4 py-2">{formatDisplayNumberWithTranslation(item.lineTotal, t, { currency: true })}</TableCell>}
                      {visibleColumns.minStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'minStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.minStockLevel !== undefined ? formatIntegerQuantityWithTranslation(item.minStockLevel, t) : '-'}</TableCell>}
                      {visibleColumns.maxStockLevel && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'maxStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.maxStockLevel !== undefined ? formatIntegerQuantityWithTranslation(item.maxStockLevel, t) : '-'}</TableCell>}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-2 p-4 border-t">
         {totalPages > 1 && (
            <div className="flex items-center justify-center sm:justify-start space-x-2 py-2 w-full sm:w-auto">
              <span className="text-sm text-muted-foreground hidden sm:block">
                {t('inventory_pagination_page_info', { currentPage: currentPage, totalPages: totalPages, totalItems: totalItems })}
              </span>
              <div className="flex space-x-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 px-2"
                >
                  <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('inventory_pagination_previous')}</span>
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
                  <span className="hidden sm:inline">{t('inventory_pagination_next')}</span> <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row justify-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button variant="outline" onClick={handleExportInventory} className="w-full sm:w-auto">
                <Download className="mr-2 h-4 w-4" /> {t('inventory_export_csv_button')}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isDeleting} className="w-full sm:w-auto">
                    {isDeleting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {t('inventory_delete_all_button')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('inventory_delete_all_confirm_title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('inventory_delete_all_confirm_desc')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteAllInventory} disabled={isDeleting} className={cn(buttonVariants({ variant: "destructive" }))}>
                      {isDeleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {t('inventory_delete_all_confirm_action')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
