import { useCallback } from 'react';
import type { EditableProduct } from '../types';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/context/AuthContext'; // Assuming User type is available

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
    const newProduct: EditableProduct = {
      id: `prod-temp-${Date.now()}-newManual`,
      _originalId: `prod-temp-${Date.now()}-newManual`,
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
    setProductsForNextStep(prev => [...prev, newProduct]);
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