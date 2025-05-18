
// src/app/inventory/page.tsx
'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'; // Added CardFooter
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download, Trash2, ChevronLeft, ChevronRight, ChevronUp, Image as ImageIconLucide, ListChecks, Grid, DollarSign } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { cn } from "@/lib/utils";
import { Product, getProductsService, clearInventoryService, updateProductService, deleteProductService } from '@/services/backend'; // Corrected import and added clearInventoryService, deleteProductService
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import NextImage from 'next/image';
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from '@/hooks/use-mobile';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';


const ITEMS_PER_PAGE = 10;

type SortKey = keyof Product | 'calculatedGrossProfit' | '';
type SortDirection = 'asc' | 'desc';

const formatDisplayNumberWithTranslation = (
    value: number | undefined | null,
    t: (key: string, params?: Record<string, string | number>) => string,
    options?: { decimals?: number, useGrouping?: boolean, currency?: boolean }
): string => {
    const { decimals = 0, useGrouping = true, currency = false } = options || {};
    const shekelSymbol = t('currency_symbol');

    if (value === null || value === undefined || isNaN(value)) {
        const zeroFormatted = (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, {
            minimumFractionDigits: currency ? (decimals === 0 ? 0 : 0) : decimals, // Changed for ₪0
            maximumFractionDigits: currency ? (decimals === 0 ? 0 : 0) : decimals, // Changed for ₪0
            useGrouping: useGrouping,
        });
        return currency ? `${shekelSymbol}${zeroFormatted}` : zeroFormatted;
    }

    const formattedValue = value.toLocaleString(t('locale_code_for_number_formatting') || undefined, {
        minimumFractionDigits: currency ? (decimals === 0 ? 0 : 0) : decimals, // Changed for ₪0
        maximumFractionDigits: currency ? (decimals === 0 ? 0 : 0) : decimals, // Changed for ₪0
        useGrouping: useGrouping,
    });
    return currency ? `${shekelSymbol}${formattedValue}` : formattedValue;
};

const formatIntegerQuantityWithTranslation = (
    value: number | undefined | null,
    t: (key: string) => string
): string => {
    if (value === null || value === undefined || isNaN(value)) {
        return (0).toLocaleString(t('locale_code_for_number_formatting') || undefined, { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    return Math.round(value).toLocaleString(t('locale_code_for_number_formatting') || undefined, { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 });
};


export default function InventoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParamsHook = useSearchParams();
  const { toast } = useToast();
  const { t, locale } = useTranslation();
  const isMobileViewHook = useIsMobile();

  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const defaultVisibleColumns: Record<keyof Product | 'actions' | 'imageUrl' , boolean> = useMemo(() => ({
    actions: true,
    imageUrl: false, 
    id: false,
    shortName: true,
    description: false,
    catalogNumber: true, 
    barcode: false,
    quantity: true,
    unitPrice: false,
    salePrice: true,
    lineTotal: false,
    minStockLevel: false, 
    maxStockLevel: false, 
    lastUpdated: false,
    userId: false,
    _originalId: false,
  }), []);

  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out' | 'over'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('shortName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');
  const [showAdvancedInventoryFilters, setShowAdvancedInventoryFilters] = useState(false);


  const inventoryValue = useMemo(() => {
    return inventory.reduce((acc, product) => acc + ((Number(product.unitPrice) || 0) * (Number(product.quantity) || 0)), 0);
  }, [inventory]);

  const stockAlerts = useMemo(() => {
    return inventory.filter(item => 
        (Number(item.quantity) || 0) === 0 || 
        (item.minStockLevel !== undefined && item.minStockLevel !== null && (Number(item.quantity) || 0) <= item.minStockLevel) ||
        (item.maxStockLevel !== undefined && item.maxStockLevel !== null && (Number(item.quantity) || 0) > item.maxStockLevel)
    );
  }, [inventory]);
  
  const stockAlertsCount = useMemo(() => stockAlerts.length, [stockAlerts]);


  const fetchInventory = useCallback(async () => {
      if (!user || !user.id) {
          setIsLoading(false);
          setInventory([]);
          return;
      }
      setIsLoading(true);
      try {
        const data = await getProductsService(user.id);
        const inventoryWithCorrectTotals = data.map(item => {
            const quantity = Number(item.quantity) || 0;
            const unitPrice = Number(item.unitPrice) || 0;
             return {
                 ...item,
                 quantity: quantity,
                 unitPrice: unitPrice,
                 salePrice: item.salePrice === undefined ? null : (item.salePrice ?? null), 
                 lineTotal: parseFloat((quantity * unitPrice).toFixed(2))
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
    const initialFilter = searchParamsHook.get('filter') as 'all' | 'low' | 'inStock' | 'out' | 'over' | null;
    const shouldRefresh = searchParamsHook.get('refresh');
    const urlViewMode = searchParamsHook.get('mobileView') as 'cards' | 'table' | null;

    if (typeof window !== 'undefined') {
        if (urlViewMode && (urlViewMode === 'cards' || urlViewMode === 'table')) {
            setViewMode(urlViewMode);
            const current = new URLSearchParams(Array.from(searchParamsHook.entries()));
            current.delete('mobileView');
            const search = current.toString();
            const query = search ? `?${search}` : "";
            router.replace(`${pathname}${query}`, { scroll: false });
        } else if (!urlViewMode && isMobileViewHook && viewMode !== 'cards') {
             // Default to table for desktop, cards for mobile can be handled by initial state or another effect
        }
    }
     if (user && user.id && (inventory.length === 0 || shouldRefresh === 'true')) {
        fetchInventory();
    } else if (!user && !authLoading) {
        router.push('/login');
    }

    if (initialFilter && ['all', 'low', 'inStock', 'out', 'over'].includes(initialFilter)) {
        setFilterStockLevel(initialFilter);
    }

    if (shouldRefresh === 'true') {
        const current = new URLSearchParams(Array.from(searchParamsHook.entries()));
        current.delete('refresh');
        const search = current.toString();
        const query = search ? `?${search}` : "";
        router.replace(`${pathname}${query}`, { scroll: false }); 
     }
   }, [authLoading, user, fetchInventory, router, searchParamsHook, pathname, inventory.length, isMobileViewHook]);


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
        result = result.filter(item => (Number(item.quantity) || 0) > 0 && (item.minStockLevel !== undefined && item.minStockLevel !== null && (Number(item.quantity) || 0) <= item.minStockLevel));
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => (Number(item.quantity) || 0) > 0);
      } else if (filterStockLevel === 'out') {
        result = result.filter(item => (Number(item.quantity) || 0) === 0);
      } else if (filterStockLevel === 'over') {
        result = result.filter(item => item.maxStockLevel !== undefined && item.maxStockLevel !== null && (Number(item.quantity) || 0) > item.maxStockLevel);
      }


      if (sortKey) {
        result.sort((a, b) => {
          let valA = a[sortKey as keyof Product];
          let valB = b[sortKey as keyof Product];

          if (sortKey === 'calculatedGrossProfit') {
            valA = (Number(a.salePrice) || 0) - (Number(a.unitPrice) || 0);
            valB = (Number(b.salePrice) || 0) - (Number(b.unitPrice) || 0);
          }

           let comparison = 0;
           if (typeof valA === 'number' && typeof valB === 'number') {
             comparison = valA - valB;
           } else if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = (valA || "").localeCompare(valB || "", locale === 'he' ? 'he-IL-u-co-standard' : 'en-US');
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
             salePrice: item.salePrice === undefined ? null : (item.salePrice ?? null),
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

    const toggleColumnVisibility = (key: keyof Product | 'actions' | 'imageUrl') => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const columnDefinitions: { key: keyof Product | 'actions' | 'imageUrl'; labelKey: string; sortable: boolean, className?: string, mobileHidden?: boolean, headerClassName?: string, isNumeric?: boolean }[] = useMemo(() => [
        { key: 'actions', labelKey: 'inventory_col_actions', sortable: false, className: 'text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2 sticky left-0 bg-card z-10' },
        { key: 'imageUrl', labelKey: 'inventory_col_image', sortable: false, className: 'w-12 text-center px-1 sm:px-2 py-1', headerClassName: 'text-center px-1 sm:px-2 py-1'},
        { key: 'shortName', labelKey: 'inventory_col_product', sortable: true, className: 'min-w-[100px] sm:min-w-[150px] px-2 sm:px-4 py-2 text-center', headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'description', labelKey: 'inventory_col_description', sortable: true, className: 'min-w-[150px] sm:min-w-[200px] px-2 sm:px-4 py-2 text-center', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'catalogNumber', labelKey: 'inventory_col_catalog', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2 text-center', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'barcode', labelKey: 'inventory_col_barcode', sortable: true, className: 'min-w-[100px] sm:min-w-[120px] px-2 sm:px-4 py-2 text-center', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2' },
        { key: 'quantity', labelKey: 'inventory_col_qty', sortable: true, className: 'text-center min-w-[60px] sm:min-w-[80px] px-2 sm:px-4 py-2', headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'unitPrice', labelKey: 'inventory_col_unit_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'salePrice', labelKey: 'inventory_col_sale_price', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: false, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'lineTotal', labelKey: 'inventory_col_total', sortable: false, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'minStockLevel', labelKey: 'product_detail_label_min_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
        { key: 'maxStockLevel', labelKey: 'product_detail_label_max_stock', sortable: true, className: 'text-center min-w-[80px] sm:min-w-[100px] px-2 sm:px-4 py-2', mobileHidden: true, headerClassName: 'text-center px-2 sm:px-4 py-2', isNumeric: true },
    ], [t]);

    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key as keyof typeof visibleColumns]);


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

        const exportColumns: (keyof Product)[] = [
            'catalogNumber', 'barcode', 'shortName', 'description', 'quantity', 'unitPrice', 'salePrice', 'lineTotal', 'minStockLevel', 'maxStockLevel', 'imageUrl'
        ];

        const headers = exportColumns
            .map(key => t(columnDefinitions.find(col => col.key === key)?.labelKey || key, { currency_symbol: t('currency_symbol') }))
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
        if (!user || !user.id) return;
        setIsDeleting(true);
        try {
            await clearInventoryService(user.id);
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

    const getStockLevelIndicator = (item: Product) => {
        const quantity = Number(item.quantity) || 0;
        const minStock = item.minStockLevel;
        const maxStock = item.maxStockLevel;

        if (quantity === 0) return "bg-red-500";
        if (maxStock !== undefined && maxStock !== null && quantity > maxStock) return "bg-orange-400";
        if (minStock !== undefined && minStock !== null && quantity <= minStock) return "bg-yellow-400";
        return "bg-green-500";
    };


   if (authLoading || (!user && !isLoading)) { 
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
         <p className="ml-2 text-muted-foreground">{t('loading_data')}</p>
       </div>
     );
   }
   if (!user && !authLoading) return null; 


  return (
      <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
       <Card className="shadow-md bg-card text-card-foreground scale-fade-in">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 p-4">
            <div>
              <CardTitle className="text-xl sm:text-2xl font-semibold text-primary flex items-center">
                <Package className="mr-2 h-5 sm:h-6 w-5 sm:w-6" /> {t('inventory_title')}
              </CardTitle>
              <CardDescription>{t('inventory_description')}</CardDescription>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAdvancedInventoryFilters(prev => !prev)}
                  className={cn("h-9 w-9 sm:h-10 sm:w-10", showAdvancedInventoryFilters && "bg-accent text-accent-foreground")}
                  aria-label={t('inventory_filter_button_aria')}
                >
                  <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const newMode = viewMode === 'table' ? 'cards' : 'table';
                    setViewMode(newMode);
                  }}
                  className="h-9 sm:h-10 px-3"
                  aria-label={t('inventory_toggle_view_mode_aria')}
                >
                  {viewMode === 'table' ? <Grid className="h-4 w-4 sm:h-5 sm:w-5" /> : <ListChecks className="h-4 w-4 sm:h-5 sm:w-5" />}
                </Button>
            </div>
         </CardHeader>
        <CardContent>
           <div className="mb-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4">
             <div className="relative w-full md:flex-grow md:max-w-xs lg:max-w-sm">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
               <Input
                 placeholder={t('inventory_search_placeholder')}
                 value={searchTerm}
                 onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                 className="pl-10 h-10"
                 aria-label={t('inventory_search_aria')}
               />
             </div>
            {showAdvancedInventoryFilters && (
                <div className="flex flex-wrap items-center gap-2 animate-in fade-in-0 duration-300">
                    <div className="flex gap-2"> {/* Wrapper div for stock and column filters */}
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted">
                            <Package className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                            {t('inventory_filter_pill_stock')}
                            <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuLabel>{t('inventory_filter_by_stock_level')}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem checked={filterStockLevel === 'all'} onCheckedChange={() => { setFilterStockLevel('all'); setCurrentPage(1); }}>{t('inventory_filter_all')}</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem checked={filterStockLevel === 'inStock'} onCheckedChange={() => { setFilterStockLevel('inStock'); setCurrentPage(1); }}>{t('inventory_filter_in_stock')}</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem checked={filterStockLevel === 'low'} onCheckedChange={() => { setFilterStockLevel('low'); setCurrentPage(1); }}>{t('inventory_filter_low')}</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem checked={filterStockLevel === 'out'} onCheckedChange={() => { setFilterStockLevel('out'); setCurrentPage(1); }}>{t('inventory_filter_out_of_stock')}</DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem checked={filterStockLevel === 'over'} onCheckedChange={() => { setFilterStockLevel('over'); setCurrentPage(1); }}>{t('inventory_filter_over_stock')}</DropdownMenuCheckboxItem>
                        </DropdownMenuContent>
                        </DropdownMenu>
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="rounded-full text-xs h-8 px-3 py-1 border bg-background hover:bg-muted">
                                <Eye className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                                {t('inventory_filter_pill_columns')}
                            <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-50" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{t('inventory_toggle_columns_label')}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {columnDefinitions.filter(h => h.key !== 'actions' && h.key !== 'id').map((header) => (
                            <DropdownMenuCheckboxItem
                                key={header.key}
                                className="capitalize"
                                checked={visibleColumns[header.key as keyof typeof visibleColumns]}
                                onCheckedChange={() => toggleColumnVisibility(header.key as keyof typeof visibleColumns)}
                            >
                                {t(header.labelKey, { currency_symbol: t('currency_symbol') })}
                            </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            )}
           </div>
            
            <Card className="shadow-sm bg-card/70 backdrop-blur-sm border-border/50 mb-6 scale-fade-in delay-100">
                 <CardHeader className="pb-3 pt-4 px-4">
                     <CardTitle className="text-base font-semibold text-primary flex items-center">
                         <Package className="mr-2 h-4 w-4" /> {t('inventory_summary_and_alerts_title')}
                     </CardTitle>
                 </CardHeader>
                 <CardContent className="grid grid-cols-2 gap-2 p-3 text-center">
                     <div className="p-2 border rounded-md bg-background/70 flex flex-col items-center">
                         <p className="text-xs text-muted-foreground flex items-center">
                             <DollarSign className="mr-1 h-3.5 w-3.5 text-green-500"/>{t('inventory_kpi_total_value_short')}
                         </p>
                         <p className="text-xl font-bold">{formatDisplayNumberWithTranslation(inventoryValue, t, { currency: true, decimals: 0 })}</p>
                     </div>
                     <div className="p-2 border rounded-md bg-background/70 flex flex-col items-center">
                         <p className="text-xs text-muted-foreground flex items-center">
                             <AlertTriangle className="mr-1 h-3.5 w-3.5 text-yellow-500"/>{t('inventory_kpi_stock_alerts_short')}
                         </p>
                         <p className="text-xl font-bold">{formatIntegerQuantityWithTranslation(stockAlertsCount, t)}</p>
                     </div>
                 </CardContent>
            </Card>

           {(viewMode === 'cards') ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6">
               {isLoading && paginatedInventory.length === 0 ? ( 
                 Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                   <Card key={index} className="animate-pulse bg-card/30 backdrop-blur-sm border-border/50 shadow">
                     <CardHeader className="pb-2 pt-3 px-3"><Skeleton className="h-5 w-3/4" /></CardHeader>
                     <CardContent className="space-y-2 pt-1 pb-3 px-3">
                       <Skeleton className="h-4 w-1/2" />
                       <Skeleton className="h-4 w-1/4" />
                     </CardContent>
                     <CardFooter className="p-2 border-t flex items-center justify-end">
                        <Skeleton className="h-7 w-7 rounded-full" />
                      </CardFooter>
                   </Card>
                 ))
               ) : paginatedInventory.length === 0 ? (
                 <div className="col-span-full text-center py-10 text-muted-foreground">
                   <Package className="mx-auto h-12 w-12 mb-2 opacity-50" />
                   <p>{t('inventory_no_items_found')}</p>
                   <Button variant="link" onClick={() => router.push('/upload')} className="mt-1 text-primary whitespace-normal h-auto">
                        {t('inventory_try_adjusting_filters_or_upload')}
                   </Button>
                 </div>
               ) : (
                 paginatedInventory.map((item) => (
                   <Card key={item.id || item.catalogNumber} className="hover:shadow-lg transition-shadow flex flex-col bg-card/70 backdrop-blur-sm border-border/50 shadow">
                     <CardHeader className="pb-2 pt-3 px-3">
                         <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2 flex-grow min-w-0">
                               <span className={cn("w-3 h-3 rounded-full flex-shrink-0", getStockLevelIndicator(item))}></span>
                               <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="link" className="p-0 h-auto text-left font-semibold text-base truncate cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground flex-1 min-w-0">
                                            <span className="truncate" title={item.shortName || item.description}>{item.shortName || item.description?.split(' ').slice(0,3).join(' ') || t('invoices_na')}</span>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent side="top" align="start" className="w-auto max-w-[300px] break-words p-3 text-xs shadow-lg space-y-1 bg-background border rounded-md">
                                        {item.description && <p><strong className="font-medium">{t('inventory_popover_description')}:</strong> {item.description}</p>}
                                        {item.catalogNumber && item.catalogNumber !== "N/A" && <p><strong className="font-medium">{t('inventory_popover_catalog')}:</strong> {item.catalogNumber}</p>}
                                        {item.barcode && <p><strong className="font-medium">{t('inventory_popover_barcode')}:</strong> {item.barcode}</p>}
                                        {item.unitPrice !== undefined && <p><strong className="font-medium">{t('inventory_col_unit_price', { currency_symbol: t('currency_symbol') })}:</strong> {formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true, decimals: 0 })}</p>}
                                    </PopoverContent>
                                </Popover>
                            </div>
                         </div>
                         {item.imageUrl && visibleColumns.imageUrl ? (
                             <div className="mt-2 relative h-24 w-full rounded overflow-hidden border" data-ai-hint="product photo">
                                 <NextImage src={item.imageUrl} alt={item.shortName || item.description || ''} layout="fill" objectFit="cover" />
                             </div>
                         ) : visibleColumns.imageUrl ? (
                             <div className="mt-2 h-24 w-full rounded bg-muted flex items-center justify-center border">
                                 <ImageIconLucide className="h-8 w-8 text-muted-foreground" />
                             </div>
                         ) : null}
                     </CardHeader>
                     <CardContent className="text-xs space-y-1 pt-1 pb-3 px-3 flex-grow">
                        <div className="text-xs text-muted-foreground">
                            <strong className="text-foreground">{t('inventory_col_qty')}:</strong> {formatIntegerQuantityWithTranslation(item.quantity, t)}
                            {item.quantity === 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1 py-0">{t('inventory_badge_out_of_stock')}</Badge>}
                            {item.quantity > 0 && item.minStockLevel !== undefined && item.minStockLevel !== null && item.quantity <= item.minStockLevel && <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-[9px] px-1 py-0">{t('inventory_badge_low_stock')}</Badge>}
                            {item.maxStockLevel !== undefined && item.maxStockLevel !== null && item.quantity > item.maxStockLevel && <Badge variant="default" className="ml-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-[9px] px-1 py-0">{t('inventory_badge_over_stock')}</Badge>}
                        </div>
                         {visibleColumns.salePrice && <p><strong className="text-foreground">{t('inventory_col_sale_price', { currency_symbol: t('currency_symbol')})}:</strong> {item.salePrice !== undefined && item.salePrice !== null ? formatDisplayNumberWithTranslation(item.salePrice, t, { currency: true, decimals: 0 }) : '-'}</p>}
                     </CardContent>
                     <CardFooter className="p-2 border-t flex items-center justify-end">
                          <Button
                             variant="ghost"
                             size="icon"
                             onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                             disabled={!item.id}
                             aria-label={t('inventory_view_details_aria', { productName: item.shortName || item.description || '' })}
                             className="h-7 w-7 text-primary hover:text-primary/80 flex-shrink-0"
                         >
                             <Eye className="h-4 w-4" />
                         </Button>
                      </CardFooter>
                   </Card>
                 ))
               )}
             </div>
           ) : (
             <div className="overflow-x-auto relative mt-6">
               <Table>
                 <TableHeader>
                   <TableRow>
                     {visibleColumnHeaders.map((header) => (
                       <TableHead
                         key={header.key}
                         className={cn(
                           "text-center", 
                           header.headerClassName, 
                           header.sortable && "cursor-pointer hover:bg-muted/50",
                           header.mobileHidden ? 'hidden sm:table-cell' : 'table-cell'
                         )}
                         onClick={() => header.sortable && handleSort(header.key as SortKey)}
                         aria-sort={header.sortable ? (sortKey === header.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                       >
                         <div className="flex items-center justify-center gap-1">
                           {t(header.labelKey, { currency_symbol: t('currency_symbol') })}
                           {header.sortable && sortKey === header.key && (
                             <span className="text-xs" aria-hidden="true">
                               {sortDirection === 'asc' ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
                             </span>
                           )}
                         </div>
                       </TableHead>
                     ))}
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {isLoading && paginatedInventory.length === 0 ? (
                      <TableRow><TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center"><div className="flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /><span className="ml-2">{t('inventory_loading_inventory')}</span></div></TableCell></TableRow>
                   ) : paginatedInventory.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">
                         <p>{t('inventory_no_items_found')}</p>
                         <Button variant="link" onClick={() => router.push('/upload')} className="mt-1 text-primary whitespace-normal h-auto">
                            {t('inventory_try_adjusting_filters_or_upload')}
                         </Button>
                       </TableCell>
                     </TableRow>
                   ) : (
                     paginatedInventory.map((item) => (
                       <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50" data-testid={`inventory-item-${item.id}`}>
                         {visibleColumns.actions && (
                           <TableCell className={cn('text-center sticky left-0 bg-card z-10 px-2 sm:px-4 py-2')}>
                              <Button
                                 variant="ghost"
                                 size="icon"
                                 onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                                 disabled={!item.id}
                                 aria-label={t('inventory_view_details_aria', { productName: item.shortName || item.description || '' })}
                                 className="h-8 w-8 text-primary hover:text-primary/80"
                               >
                                 <Eye className="h-4 w-4" />
                               </Button>
                           </TableCell>
                         )}
                         {visibleColumns.imageUrl && (
                             <TableCell className={cn('text-center px-1 sm:px-2 py-1', columnDefinitions.find(h => h.key === 'imageUrl')?.className)}>
                                 {item.imageUrl ? (
                                     <div className="relative h-10 w-10 mx-auto rounded overflow-hidden border" data-ai-hint="product photo">
                                         <NextImage src={item.imageUrl} alt={item.shortName || item.description || ''} layout="fill" objectFit="cover" />
                                     </div>
                                 ) : (
                                     <div className="h-10 w-10 mx-auto rounded bg-muted flex items-center justify-center border">
                                         <ImageIconLucide className="h-5 w-5 text-muted-foreground" />
                                     </div>
                                 )}
                             </TableCell>
                         )}
                         {visibleColumns.shortName && (
                           <TableCell className="font-medium px-2 sm:px-4 py-2 truncate max-w-[100px] sm:max-w-[150px] text-center">
                             <Popover>
                               <PopoverTrigger asChild>
                                 <Button variant="link" className="p-0 h-auto text-center font-medium cursor-pointer hover:underline decoration-dashed decoration-muted-foreground/50 underline-offset-2 text-foreground">
                                   {item.shortName || item.description?.split(' ').slice(0,3).join(' ') || t('invoices_na')}
                                 </Button>
                               </PopoverTrigger>
                               <PopoverContent side="top" align="start" className="w-auto max-w-[300px] break-words p-3 text-sm shadow-lg space-y-1 bg-background border rounded-md">
                                  {item.description && <p><strong className="font-medium">{t('inventory_popover_description')}:</strong> {item.description}</p>}
                                  {item.catalogNumber && item.catalogNumber !== "N/A" && <p><strong className="font-medium">{t('inventory_popover_catalog')}:</strong> {item.catalogNumber}</p>}
                                  {item.barcode && <p><strong className="font-medium">{t('inventory_popover_barcode')}:</strong> {item.barcode}</p>}
                                  {item.unitPrice !== undefined && <p><strong className="font-medium">{t('inventory_col_unit_price', { currency_symbol: t('currency_symbol') })}:</strong> {formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true, decimals: 0 })}</p>}
                               </PopoverContent>
                             </Popover>
                           </TableCell>
                         )}
                         {visibleColumns.description && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'description')?.mobileHidden && 'hidden sm:table-cell', 'truncate max-w-[150px] sm:max-w-md')}>{item.description || t('invoices_na')}</TableCell>}
                         {visibleColumns.catalogNumber && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'catalogNumber')?.mobileHidden && 'hidden sm:table-cell')}>{item.catalogNumber || t('invoices_na')}</TableCell>}
                         {visibleColumns.barcode && <TableCell className={cn('px-2 sm:px-4 py-2 text-center', columnDefinitions.find(h => h.key === 'barcode')?.mobileHidden && 'hidden sm:table-cell')}>{item.barcode || t('invoices_na')}</TableCell>}
                         {visibleColumns.quantity && (
                           <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h => h.key === 'quantity')?.className)}>
                             <div className="flex items-center justify-center gap-1 sm:gap-2">
                                <span className="min-w-[20px] sm:min-w-[30px] text-center font-semibold">{formatIntegerQuantityWithTranslation(item.quantity, t)}</span>
                                <span className={cn("w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ml-1 sm:ml-2 flex-shrink-0", getStockLevelIndicator(item))}></span>
                             </div>
                           </TableCell>
                         )}
                         {visibleColumns.unitPrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'unitPrice')?.mobileHidden && 'hidden sm:table-cell')}>{formatDisplayNumberWithTranslation(item.unitPrice, t, { currency: true, decimals: 0 })}</TableCell>}
                         {visibleColumns.salePrice && <TableCell className={cn('text-center px-2 sm:px-4 py-2', columnDefinitions.find(h => h.key === 'salePrice')?.mobileHidden && 'hidden sm:table-cell')}>{item.salePrice !== undefined && item.salePrice !== null ? formatDisplayNumberWithTranslation(item.salePrice, t, { currency: true, decimals: 0 }) : '-'}</TableCell>}
                         {visibleColumns.lineTotal && <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h=>h.key === 'lineTotal')?.mobileHidden && 'hidden sm:table-cell')}>{formatDisplayNumberWithTranslation(item.lineTotal, t, { currency: true, decimals: 0 })}</TableCell>}
                         {visibleColumns.minStockLevel && <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h=>h.key === 'minStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.minStockLevel !== undefined && item.minStockLevel !== null ? formatIntegerQuantityWithTranslation(item.minStockLevel, t) : '-'}</TableCell>}
                         {visibleColumns.maxStockLevel && <TableCell className={cn("text-center px-2 sm:px-4 py-2", columnDefinitions.find(h=>h.key === 'maxStockLevel')?.mobileHidden && 'hidden sm:table-cell')}>{item.maxStockLevel !== undefined && item.maxStockLevel !== null ? formatIntegerQuantityWithTranslation(item.maxStockLevel, t) : '-'}</TableCell>}
                       </TableRow>
                     ))
                   )}
                 </TableBody>
               </Table>
             </div>
           )}
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
                   <Button variant="destructive" disabled={isDeleting || inventory.length === 0} className="w-full sm:w-auto">
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

