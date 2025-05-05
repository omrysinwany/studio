
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
import { Search, Filter, ChevronDown, Loader2, Eye, Package, AlertTriangle, Download } from 'lucide-react'; // Added Download
import { useRouter, useSearchParams, usePathname } from 'next/navigation'; // Import usePathname
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Product, getProductsService } from '@/services/backend'; // Corrected import
import { Badge } from '@/components/ui/badge';


// Assume backend provides categories - Removed for now
// const MOCK_CATEGORIES = ['Widgets', 'Gadgets', 'Components', 'Other'];

type SortKey = keyof Product | '';
type SortDirection = 'asc' | 'desc';

export default function InventoryPage() {
  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'id' , boolean>>({
    id: false, // Keep ID internal if not needed for display but useful for export/keys
    description: true,
    catalogNumber: true,
    quantity: true,
    unitPrice: true,
    lineTotal: true,
    actions: true,
  });
  // const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock' | 'out'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('description');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
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
        // Add a temporary ID for React keys if backend doesn't provide one - ID is now generated in backend.ts
        // const inventoryWithIds = data.map((item, index) => ({
        //   ...item,
        //   id: item.id || `temp-${index}-${Date.now()}`,
        // }));
        setInventory(data); // Use data directly as IDs should be handled by backend service
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
    //  if (filterCategory) { ... }
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
              if (valA == null && valB != null) comparison = 1;
              else if (valA != null && valB == null) comparison = -1;
              else comparison = 0;
           }

          return sortDirection === 'asc' ? comparison : comparison * -1;
        });
      }

     return result;
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection]);

    const toggleColumnVisibility = (key: keyof Product | 'actions' | 'id') => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Column definition including internal 'id'
    const columnDefinitions: { key: keyof Product | 'actions' | 'id'; label: string; sortable: boolean, className?: string }[] = [
        { key: 'id', label: 'ID', sortable: true }, // Keep ID for potential export
        { key: 'description', label: 'Product Description', sortable: true, className: 'min-w-[200px]' },
        { key: 'catalogNumber', label: 'Catalog #', sortable: true, className: 'min-w-[120px]' },
        { key: 'quantity', label: 'Quantity', sortable: true, className: 'text-right min-w-[100px]' },
        { key: 'unitPrice', label: 'Unit Price (₪)', sortable: true, className: 'text-right min-w-[100px]' },
        { key: 'lineTotal', label: 'Line Total (₪)', sortable: true, className: 'text-right min-w-[100px]' },
        { key: 'actions', label: 'Actions', sortable: false, className: 'text-right' }
    ];

    // Filter columns for header display based on visibility state
    const visibleColumnHeaders = columnDefinitions.filter(h => visibleColumns[h.key]);


    // --- CSV Export ---
    const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
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


    if (isLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       <Card className="shadow-md bg-card text-card-foreground">
         <CardHeader>
           <CardTitle className="text-2xl font-semibold text-primary flex items-center">
              <Package className="mr-2 h-6 w-6" /> Inventory Overview
           </CardTitle>
           <CardDescription>Browse, search, and manage your inventory items.</CardDescription>
         </CardHeader>
         <CardContent>
           {/* Toolbar */}
           <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
              <div className="relative w-full md:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by description or catalog..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  aria-label="Search inventory"
                />
              </div>
               <div className="flex gap-2 flex-wrap justify-center md:justify-end">
                 {/* Category Filter - Removed */}

                   {/* Stock Level Filter */}
                   <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Filter className="mr-2 h-4 w-4" />
                         {filterStockLevel === 'low' ? 'Low Stock' :
                          filterStockLevel === 'inStock' ? 'In Stock' :
                          filterStockLevel === 'out' ? 'Out of Stock' :
                          'Stock Level'}
                        <ChevronDown className="ml-2 h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                       <DropdownMenuLabel>Filter by Stock Level</DropdownMenuLabel>
                       <DropdownMenuSeparator />
                       <DropdownMenuCheckboxItem
                           checked={filterStockLevel === 'all'}
                           onCheckedChange={() => setFilterStockLevel('all')}
                         >
                           All
                       </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            checked={filterStockLevel === 'inStock'}
                            onCheckedChange={() => setFilterStockLevel('inStock')}
                          >
                            In Stock
                        </DropdownMenuCheckboxItem>
                       <DropdownMenuCheckboxItem
                         checked={filterStockLevel === 'low'}
                         onCheckedChange={() => setFilterStockLevel('low')}
                       >
                         Low Stock (1-10)
                       </DropdownMenuCheckboxItem>
                         <DropdownMenuCheckboxItem
                         checked={filterStockLevel === 'out'}
                         onCheckedChange={() => setFilterStockLevel('out')}
                       >
                         Out of Stock (0)
                       </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>


                 {/* Column Visibility Toggle */}
                 <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                     <Button variant="outline">
                       <Eye className="mr-2 h-4 w-4" /> View
                       <ChevronDown className="ml-2 h-4 w-4" />
                     </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                     {/* Map over definitions that should be toggleable (exclude 'actions' or 'id' if needed) */}
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
                  <Button variant="outline" onClick={handleExportInventory}>
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>

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
                 {filteredAndSortedInventory.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={visibleColumnHeaders.length} className="h-24 text-center">
                       No inventory items found matching your criteria.
                     </TableCell>
                   </TableRow>
                 ) : (
                   filteredAndSortedInventory.map((item) => (
                     <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50" data-testid={`inventory-item-${item.id}`}>
                       {/* Render cells based on visibility state */}
                        {visibleColumns.description && <TableCell className="font-medium">{item.description || 'N/A'}</TableCell>}
                        {visibleColumns.catalogNumber && <TableCell>{item.catalogNumber || 'N/A'}</TableCell>}
                        {visibleColumns.quantity && (
                          <TableCell className="text-right">
                            <span>{item.quantity}</span>
                            {item.quantity === 0 && (
                              <Badge variant="destructive" className="ml-2">Out</Badge>
                            )}
                            {item.quantity > 0 && item.quantity <= 10 && (
                              <Badge variant="secondary" className="ml-2 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100/80">Low</Badge>
                            )}
                          </TableCell>
                        )}
                        {visibleColumns.unitPrice && <TableCell className="text-right">₪{item.unitPrice?.toFixed(2) ?? '0.00'}</TableCell>}
                        {visibleColumns.lineTotal && <TableCell className="text-right">₪{item.lineTotal?.toFixed(2) ?? '0.00'}</TableCell>}
                       {visibleColumns.actions && (
                         <TableCell className="text-right">
                           <Button
                             variant="ghost"
                             size="sm"
                             onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                             disabled={!item.id}
                             aria-label={`View details for ${item.description}`}
                           >
                             <Eye className="mr-1 h-4 w-4" /> Details
                           </Button>
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
