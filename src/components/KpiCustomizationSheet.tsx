
// src/components/KpiCustomizationSheet.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ItemConfig } from '@/app/page'; // Use the generic ItemConfig
import { useTranslation } from '@/hooks/useTranslation';
import { Save, X, ArrowUp, ArrowDown } from 'lucide-react';

interface CustomizationSheetProps { // Renamed for clarity
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  items: ItemConfig[]; // Use generic ItemConfig
  currentVisibleItemIds: string[];
  currentItemOrder: string[];
  onSavePreferences: (preferences: { visibleItemIds: string[], itemOrder: string[] }) => void;
  sheetTitleKey: string; // For dynamic title
  sheetDescriptionKey: string; // For dynamic description
}

const KpiCustomizationSheet: React.FC<CustomizationSheetProps> = ({
  isOpen,
  onOpenChange,
  items, // Use generic items
  currentVisibleItemIds,
  currentItemOrder,
  onSavePreferences,
  sheetTitleKey,
  sheetDescriptionKey,
}) => {
  const { t } = useTranslation();
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [editableItemOrder, setEditableItemOrder] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedItemIds(new Set(currentVisibleItemIds));
      const currentOrderSet = new Set(currentItemOrder);
      const newItemsToAdd = items.filter(item => !currentOrderSet.has(item.id)).map(item => item.id);
      // Ensure the order only contains valid items from the current 'items' prop
      const validCurrentOrder = currentItemOrder.filter(id => items.some(item => item.id === id));
      setEditableItemOrder([...validCurrentOrder, ...newItemsToAdd]);
    }
  }, [isOpen, currentVisibleItemIds, currentItemOrder, items]);

  const handleToggleItem = (itemId: string) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    setEditableItemOrder(prevOrder => {
      const newOrder = [...prevOrder];
      const itemToMove = newOrder[index];
      if (direction === 'up' && index > 0) {
        newOrder.splice(index, 1);
        newOrder.splice(index - 1, 0, itemToMove);
      } else if (direction === 'down' && index < newOrder.length - 1) {
        newOrder.splice(index, 1);
        newOrder.splice(index + 1, 0, itemToMove);
      }
      return newOrder;
    });
  };

  const handleSave = () => {
    const newVisibleIds = Array.from(selectedItemIds);
    onSavePreferences({
      visibleItemIds: newVisibleIds, // Corrected prop name
      itemOrder: editableItemOrder,    // Corrected prop name
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-6 border-b">
          <SheetTitle>{t(sheetTitleKey)}</SheetTitle>
          <SheetDescription>{t(sheetDescriptionKey)}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-grow p-6 space-y-1">
          <p className="text-sm font-medium mb-2">{t('home_kpi_customize_select_label')}:</p>
          {editableItemOrder.map((itemId, index) => {
            const item = items.find(k => k.id === itemId);
            if (!item) return null;
            return (
              <div key={item.id} className="flex items-center space-x-2 p-2 hover:bg-muted/50 rounded-md group">
                <div className="flex flex-col gap-1 mr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(index, 'up')}
                    disabled={index === 0}
                    className="h-7 w-7 p-1.5 opacity-70 group-hover:opacity-100 disabled:opacity-30"
                    aria-label={t('move_up_button')}
                  >
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveItem(index, 'down')}
                    disabled={index === editableItemOrder.length - 1}
                    className="h-7 w-7 p-1.5 opacity-70 group-hover:opacity-100 disabled:opacity-30"
                    aria-label={t('move_down_button')}
                  >
                    <ArrowDown className="h-5 w-5" />
                  </Button>
                </div>
                <Checkbox
                  id={`item-toggle-${item.id}`}
                  checked={selectedItemIds.has(item.id)}
                  onCheckedChange={() => handleToggleItem(item.id)}
                />
                <Label htmlFor={`item-toggle-${item.id}`} className="flex-1 text-sm font-normal cursor-pointer">
                  {t(item.titleKey)}
                </Label>
              </div>
            );
          })}
        </ScrollArea>
        <SheetFooter className="p-6 border-t flex-col sm:flex-row gap-2">
          <SheetClose asChild>
            <Button variant="outline" className="w-full sm:w-auto">
                <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
            </Button>
          </SheetClose>
          <Button onClick={handleSave} className="w-full sm:w-auto">
             <Save className="mr-2 h-4 w-4" /> {t('save_button')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default KpiCustomizationSheet;

