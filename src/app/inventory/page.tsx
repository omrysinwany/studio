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
import { Search, Filter, ChevronDown, Loader2, Eye, Package } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation'; // Import useSearchParams
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Product, getProductsService } from '@/services/backend'; // Import getProductsService


// Mock data removed, using backend service

// Assume backend provides categories
const MOCK_CATEGORIES = ['Widgets', 'Gadgets', 'Components', 'Other'];

type SortKey = keyof Product | '';
type SortDirection = 'asc' | 'desc';

export default function InventoryPage() {
  const [inventory, setInventory] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof Product | 'actions' | 'id' , boolean>>({
    id: false, // Keep ID hidden by default, but trackable
    description: true, // Use 'description' instead of 'name' from Product interface
    catalogNumber: true,
    quantity: true,
    unitPrice: true,
    // category: true, // Category not in Product interface
    // lastUpdated: true, // lastUpdated not in Product interface
    lineTotal: true, // Add lineTotal if needed/available
    actions: true, // Column for actions like 'View Details'
  });
  // const [filterCategory, setFilterCategory] = useState<string>(''); // Category filter depends on data
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('description'); // Default sort by description
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const router = useRouter();
  const searchParams = useSearchParams(); // Get search params
  const { toast } = useToast();
  const shouldRefresh = searchParams.get('refresh'); // Check for refresh param


   // Fetch inventory data (replace with actual API call)
   useEffect(() => {
     const fetchInventory = async () => {
       setIsLoading(true);
       try {
         console.log("Fetching inventory data...");
         const data = await getProductsService(); // Fetch products from backend service using the renamed function
          console.log("Fetched inventory data:", data);
          // Add a temporary ID for React keys if backend doesn't provide one
          const inventoryWithIds = data.map((item, index) => ({
            ...item,
            id: item.id || `temp-${index}-${Date.now()}`, // Use backend ID or generate temp one
          }));
         setInventory(inventoryWithIds);
       } catch (error) {
         console.error("Failed to fetch inventory:", error);
         toast({
           title: "Error Fetching Inventory",
           description: "Could not load inventory data. Please try again later.",
           variant: "destructive",
         });
         setInventory([]); // Clear inventory on error
       } finally {
         setIsLoading(false);
       }
     };

     fetchInventory();

     // Optionally remove the refresh param after fetching to prevent infinite loops if state changes cause re-renders
     // if (shouldRefresh) {
     //    router.replace('/inventory', { scroll: false }); // Remove query param without scroll jump
     // }

   }, [toast, shouldRefresh]); // Add shouldRefresh to dependency array


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
         (item.description?.toLowerCase() || '').includes(lowerSearchTerm) || // Search in description
         (item.catalogNumber?.toLowerCase() || '').includes(lowerSearchTerm)
       );
     }
    //  if (filterCategory) { // Re-enable if category is added back
    //    result = result.filter(item => item.category === filterCategory);
    //  }
      if (filterStockLevel === 'low') {
        result = result.filter(item => item.quantity <= 10); // Example threshold for low stock
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => item.quantity > 0);
      }


     // Sorting
      if (sortKey) {
        result.sort((a, b) => {
          const valA = a[sortKey as keyof Product];
          const valB = b[sortKey as keyof Product];

           // Handle different data types for comparison
           let comparison = 0;
           if (typeof valA === 'number' && typeof valB === 'number') {
             comparison = valA - valB;
           } else if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB);
           } else {
              // Fallback for mixed types or other types - place undefined/null last
              if (valA == null && valB != null) comparison = 1;
              else if (valA != null && valB == null) comparison = -1;
              else comparison = 0; // Keep original order if types are unexpected or both null/undefined
           }


          return sortDirection === 'asc' ? comparison : comparison * -1;
        });
      }


     return result;
      }, [inventory, searchTerm, filterStockLevel, sortKey, sortDirection]); // Removed filterCategory dependency

    const toggleColumnVisibility = (key: keyof Product | 'actions' | 'id') => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };


  const columnHeaders: { key: keyof Product | 'actions' | 'id'; label: string; sortable: boolean, className?: string }[] = [
     { key: 'description', label: 'Product Description', sortable: true, className: 'min-w-[200px]' },
     { key: 'catalogNumber', label: 'Catalog #', sortable: true, className: 'min-w-[120px]' },
     { key: 'quantity', label: 'Quantity', sortable: true, className: 'text-right min-w-[80px]' },
     { key: 'unitPrice', label: 'Unit Price (₪)', sortable: true, className: 'text-right min-w-[100px]' }, // Updated label
     { key: 'lineTotal', label: 'Line Total (₪)', sortable: true, className: 'text-right min-w-[100px]' }, // Updated label
     // { key: 'category', label: 'Category', sortable: true, className: 'min-w-[100px]' },
     // { key: 'lastUpdated', label: 'Last Updated', sortable: true, className: 'min-w-[150px]' },
     { key: 'actions', label: 'Actions', sortable: false, className: 'text-right' }
  ];

    if (isLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
       <Card className="shadow-md">
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
                  placeholder="Search by description or catalog..." // Updated placeholder
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
               <div className="flex gap-2 flex-wrap justify-center md:justify-end">
                 {/* Category Filter - Removed, re-add if category is available */}
                 {/* <DropdownMenu> ... </DropdownMenu> */}

                   {/* Stock Level Filter */}
                   <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Filter className="mr-2 h-4 w-4" />
                         {filterStockLevel === 'low' ? 'Low Stock' : filterStockLevel === 'inStock' ? 'In Stock' : 'Stock Level'}
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
                         Low Stock (≤10)
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
                     {columnHeaders.map((header) => (
                       <DropdownMenuCheckboxItem
                         key={header.key}
                         className="capitalize"
                         checked={visibleColumns[header.key]}
                         onCheckedChange={() => toggleColumnVisibility(header.key as keyof Product | 'actions' | 'id')}
                       >
                         {header.label}
                       </DropdownMenuCheckboxItem>
                     ))}
                   </DropdownMenuContent>
                 </DropdownMenu>
               </div>
           </div>

           {/* Inventory Table */}
           <div className="overflow-x-auto">
             <Table>
               <TableHeader>
                 <TableRow>
                    {columnHeaders.filter(h => visibleColumns[h.key]).map((header) => (
                         <TableHead
                            key={header.key}
                            className={cn(header.className, header.sortable && "cursor-pointer hover:bg-muted/50")}
                            onClick={() => header.sortable && handleSort(header.key as SortKey)} // Cast key to SortKey
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
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {filteredAndSortedInventory.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={columnHeaders.filter(h => visibleColumns[h.key]).length} className="h-24 text-center">
                       No inventory items found matching your criteria.
                     </TableCell>
                   </TableRow>
                 ) : (
                   filteredAndSortedInventory.map((item) => (
                     <TableRow key={item.id || item.catalogNumber} className="hover:bg-muted/50">
                       {visibleColumns.description && <TableCell className="font-medium">{item.description || 'N/A'}</TableCell>}
                        {visibleColumns.catalogNumber && <TableCell>{item.catalogNumber || 'N/A'}</TableCell>}
                        {visibleColumns.quantity && (
                          <TableCell className={cn("text-right", item.quantity <= 10 && "text-destructive font-semibold")}>
                             {item.quantity}
                             {item.quantity <= 10 && item.quantity > 0 && <span className="ml-1 text-xs">(Low)</span>}
                             {item.quantity === 0 && <span className="ml-1 text-xs">(Out)</span>}
                          </TableCell>
                        )}
                        {visibleColumns.unitPrice && <TableCell className="text-right">₪{item.unitPrice?.toFixed(2) ?? '0.00'}</TableCell>}
                        {visibleColumns.lineTotal && <TableCell className="text-right">₪{item.lineTotal?.toFixed(2) ?? '0.00'}</TableCell>}
                       {visibleColumns.actions && (
                         <TableCell className="text-right">
                           <Button
                             variant="ghost"
                             size="sm"
                             // Ensure item.id is defined before navigating
                             onClick={() => item.id && router.push(`/inventory/${item.id}`)}
                             disabled={!item.id} // Disable if no ID
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
