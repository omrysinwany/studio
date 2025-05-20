// src/app/edit-invoice/hooks/useProductHandlers.ts
import { useCallback } from 'react';
import type { EditableProduct } from '../types';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/context/AuthContext'; // Assuming User type is available
import { v4 as uuidv4 } from 'uuid'; // Import uuid

interface UseProductHandlersProps {
  setProducts: React.Dispatch<React.SetStateAction<EditableProduct[]>>;
  setProductsForNextStep: React.Dispatch<React.SetStateAction<EditableProduct[]>>;
  t: (key: string, params?: Record<string, string | number>) => string;
  user: User | null; // For userId in new product
}

export interface UseProductHandlersReturn {
  handleAddRow: () => void;
  handleRemoveRow: (id: string) => void;
}

export function useProductHandlers({
  setProducts,
  setProductsForNextStep,
  t,
  user,
}: UseProductHandlersProps): UseProductHandlersReturn {
  const { toast } = useToast();

  const handleAddRow = useCallback(() => {
    const uniqueId = `prod-temp-${uuidv4()}`; // Use uuid for unique ID
    const newProduct: EditableProduct = {
      id: uniqueId,
      _originalId: uniqueId, // Use the same unique ID for _originalId if it's a new manual entry
      userId: user?.id || 'unknown_user',
      catalogNumber: '',
      description: '',
      quantity: 0,
      unitPrice: 0,
      lineTotal: 0,
      barcode: null,
      minStockLevel: null,
      maxStockLevel: null,
      salePrice: null,
      imageUrl: null,
    };
    setProducts(prevProducts => [...prevProducts, newProduct]);
    setProductsForNextStep(prev => [...prev, newProduct]); // Also update productsForNextStep
  }, [user?.id, setProducts, setProductsForNextStep]);

  const handleRemoveRow = useCallback((id: string) => {
    setProducts(prevProducts => prevProducts.filter(product => product.id !== id));
    setProductsForNextStep(prev => prev.filter(product => product.id !== id));
    toast({
      title: t('edit_invoice_toast_row_removed_title'),
      description: t('edit_invoice_toast_row_removed_desc'),
      variant: "default",
    });
  }, [setProducts, setProductsForNextStep, t, toast]);

  return { handleAddRow, handleRemoveRow };
}