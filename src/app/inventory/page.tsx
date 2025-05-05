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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

// Mock Product Data - Replace with actual API call
interface InventoryProduct {
  id: string;
  name: string;
  catalogNumber: string;
  quantity: number;
  unitPrice: number; // Effective unit price
  category?: string; // Optional category for filtering
  lastUpdated: string; // ISO date string
}

const MOCK_INVENTORY: InventoryProduct[] = [
  { id: 'prod1', name: 'Standard Widget', catalogNumber: 'WDG-001', quantity: 150, unitPrice: 10.50, category: 'Widgets', lastUpdated: new Date(Date.now() - 86400000 * 2).toISOString() }, // 2 days ago
  { id: 'prod2', name: 'Premium Gadget', catalogNumber: 'GDG-PREM', quantity: 75, unitPrice: 49.99, category: 'Gadgets', lastUpdated: new Date().toISOString() }, // Today
  { id: 'prod3', name: 'Basic Component', catalogNumber: 'CMP-BSE', quantity: 500, unitPrice: 1.25, category: 'Components', lastUpdated: new Date(Date.now() - 86400000 * 5).toISOString() }, // 5 days ago
  { id: 'prod4', name: 'Advanced Widget', catalogNumber: 'WDG-ADV', quantity: 0, unitPrice: 25.00, category: 'Widgets', lastUpdated: new Date(Date.now() - 86400000 * 1).toISOString() }, // 1 day ago (Low Stock)
  { id: 'prod5', name: 'Ultra Component', catalogNumber: 'CMP-ULT', quantity: 10, unitPrice: 5.75, category: 'Components', lastUpdated: new Date(Date.now() - 86400000 * 10).toISOString() }, // 10 days ago (Low Stock)
   // Add more mock data as needed
];

// Assume backend provides categories
const MOCK_CATEGORIES = ['Widgets', 'Gadgets', 'Components', 'Other'];

type SortKey = keyof InventoryProduct | '';
type SortDirection = 'asc' | 'desc';

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<Record<keyof InventoryProduct, boolean>>({
    id: false, // Hide ID by default
    name: true,
    catalogNumber: true,
    quantity: true,
    unitPrice: true,
    category: true,
    lastUpdated: true,
  });
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStockLevel, setFilterStockLevel] = useState<'all' | 'low' | 'inStock'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('lastUpdated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();


   // Fetch inventory data (replace with actual API call)
   useEffect(() => {
     const fetchInventory = async () => {
       if (!user) return; // Don't fetch if not logged in
       setIsLoading(true);
       try {
         // Simulate API call delay
         await new Promise(resolve => setTimeout(resolve, 1000));
         // TODO: Replace MOCK_INVENTORY with actual API call:
         // const response = await fetch('/api/inventory', { headers: { 'Authorization': `Bearer ${token}` }});
         // const data = await response.json();
         // setInventory(data);
         setInventory(MOCK_INVENTORY);
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

     if (!authLoading && user) {
        fetchInventory();
     } else if (!authLoading && !user) {
        setIsLoading(false); // Stop loading if not logged in
        setInventory([]); // Clear inventory if logged out
     }
   }, [authLoading, user, toast]); // Depend on auth state


   // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
       toast({
         title: "Authentication Required",
         description: "Please log in to view inventory.",
         variant: "destructive",
       });
    }
  }, [authLoading, user, router, toast]);


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
         item.name.toLowerCase().includes(lowerSearchTerm) ||
         item.catalogNumber.toLowerCase().includes(lowerSearchTerm)
       );
     }
     if (filterCategory) {
       result = result.filter(item => item.category === filterCategory);
     }
      if (filterStockLevel === 'low') {
        result = result.filter(item => item.quantity <= 10); // Example threshold for low stock
      } else if (filterStockLevel === 'inStock') {
        result = result.filter(item => item.quantity > 0);
      }


     // Sorting
      if (sortKey) {
        result.sort((a, b) => {
          const valA = a[sortKey];
          const valB = b[sortKey];

           // Handle different data types for comparison
           let comparison = 0;
           if (typeof valA === 'number' && typeof valB === 'number') {
             comparison = valA - valB;
           } else if (typeof valA === 'string' && typeof valB === 'string') {
             // Consider date sorting for 'lastUpdated'
             if (sortKey === 'lastUpdated') {
                comparison = new Date(valA).getTime() - new Date(valB).getTime();
             } else {
                comparison = valA.localeCompare(valB);
             }
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
   }, [inventory, searchTerm, filterCategory, filterStockLevel, sortKey, sortDirection]);

    const toggleColumnVisibility = (key: keyof InventoryProduct) => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };


  const columnHeaders: { key: keyof InventoryProduct; label: string; sortable: boolean, className?: string }[] = [
     { key: 'name', label: 'Product Name', sortable: true, className: 'min-w-[200px]' },
     { key: 'catalogNumber', label: 'Catalog #', sortable: true, className: 'min-w-[120px]' },
     { key: 'quantity', label: 'Quantity', sortable: true, className: 'text-right min-w-[80px]' },
     { key: 'unitPrice', label: 'Unit Price', sortable: true, className: 'text-right min-w-[100px]' },
     { key: 'category', label: 'Category', sortable: true, className: 'min-w-[100px]' },
     { key: 'lastUpdated', label: 'Last Updated', sortable: true, className: 'min-w-[150px]' },
  ];

   // Format date for display
   const formatDate = (dateString: string) => {
     try {
       return new Date(dateString).toLocaleDateString();
     } catch (e) {
       return 'Invalid Date';
     }
   };


    if (authLoading) {
     return (
       <div className="container mx-auto p-4 md:p-8 flex justify-center items-center min-h-[calc(100vh-var(--header-height,4rem))]">
         <Loader2 className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

    if (!user) {
        // Should be redirected by the effect, but this is a fallback
        return <div className="container mx-auto p-4 md:p-8"><p>Redirecting to login...</p></div>;
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
                  placeholder="Search by name or catalog..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
               <div className="flex gap-2 flex-wrap justify-center md:justify-end">
                 {/* Category Filter */}
                 <DropdownMenu>
                   <DropdownMenuTrigger asChild>
                     <Button variant="outline">
                       <Filter className="mr-2 h-4 w-4" />
                       {filterCategory || 'Category'}
                       <ChevronDown className="ml-2 h-4 w-4" />
                     </Button>
                   </DropdownMenuTrigger>
                   <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Filter by Category</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                          checked={!filterCategory}
                          onCheckedChange={() => setFilterCategory('')}
                        >
                          All Categories
                      </DropdownMenuCheckboxItem>
                     {MOCK_CATEGORIES.map((category) => (
                       <DropdownMenuCheckboxItem
                         key={category}
                         checked={filterCategory === category}
                         onCheckedChange={() => setFilterCategory(category)}
                       >
                         {category}
                       </DropdownMenuCheckboxItem>
                     ))}
                   </DropdownMenuContent>
                 </DropdownMenu>

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
                         onCheckedChange={() => toggleColumnVisibility(header.key)}
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
                   <TableHead className="text-right">Actions</TableHead> {/* Action column */}
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={columnHeaders.filter(h => visibleColumns[h.key]).length + 1} className="h-24 text-center">
                        <div className="flex justify-center items-center">
                           <Loader2 className="h-6 w-6 animate-spin text-primary" />
                           <span className="ml-2">Loading inventory...</span>
                        </div>
                     </TableCell>
                   </TableRow>
                 ) : filteredAndSortedInventory.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={columnHeaders.filter(h => visibleColumns[h.key]).length + 1} className="h-24 text-center">
                       No inventory items found matching your criteria.
                     </TableCell>
                   </TableRow>
                 ) : (
                   filteredAndSortedInventory.map((item) => (
                     <TableRow key={item.id} className="hover:bg-muted/50">
                       {visibleColumns.name && <TableCell className="font-medium">{item.name}</TableCell>}
                        {visibleColumns.catalogNumber && <TableCell>{item.catalogNumber}</TableCell>}
                        {visibleColumns.quantity && (
                          <TableCell className={cn("text-right", item.quantity <= 10 && "text-destructive font-semibold")}>
                             {item.quantity}
                             {item.quantity <= 10 && item.quantity > 0 && <span className="ml-1 text-xs">(Low)</span>}
                             {item.quantity === 0 && <span className="ml-1 text-xs">(Out)</span>}
                          </TableCell>
                        )}
                        {visibleColumns.unitPrice && <TableCell className="text-right">${item.unitPrice.toFixed(2)}</TableCell>}
                        {visibleColumns.category && <TableCell>{item.category || '-'}</TableCell>}
                       {visibleColumns.lastUpdated && <TableCell>{formatDate(item.lastUpdated)}</TableCell>}
                       <TableCell className="text-right">
                         <Button
                           variant="ghost"
                           size="sm"
                           onClick={() => router.push(`/inventory/${item.id}`)} // Navigate to detail view
                           aria-label={`View details for ${item.name}`}
                         >
                           <Eye className="mr-1 h-4 w-4" /> Details
                         </Button>
                       </TableCell>
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
