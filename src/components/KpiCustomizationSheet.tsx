
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
import type { KpiConfig } from '@/app/page';
import { useTranslation } from '@/hooks/useTranslation';
import { Save, X, ArrowUp, ArrowDown } from 'lucide-react';

interface KpiCustomizationSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  allKpis: KpiConfig[];
  currentVisibleKpiIds: string[];
  currentKpiOrder: string[];
  onSavePreferences: (preferences: { visibleKpiIds: string[], kpiOrder: string[] }) => void;
}

const KpiCustomizationSheet: React.FC<KpiCustomizationSheetProps> = ({
  isOpen,
  onOpenChange,
  allKpis,
  currentVisibleKpiIds,
  currentKpiOrder,
  onSavePreferences,
}) => {
  const { t } = useTranslation();
  const [selectedKpiIds, setSelectedKpiIds] = useState<Set<string>>(new Set());
  const [editableKpiOrder, setEditableKpiOrder] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSelectedKpiIds(new Set(currentVisibleKpiIds));
      const currentOrderSet = new Set(currentKpiOrder);
      const newKpisToAdd = allKpis.filter(kpi => !currentOrderSet.has(kpi.id)).map(kpi => kpi.id);
      const validCurrentOrder = currentKpiOrder.filter(id => allKpis.some(kpi => kpi.id === id));
      setEditableKpiOrder([...validCurrentOrder, ...newKpisToAdd]);
    }
  }, [isOpen, currentVisibleKpiIds, currentKpiOrder, allKpis]);

  const handleToggleKpi = (kpiId: string) => {
    setSelectedKpiIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(kpiId)) {
        newSet.delete(kpiId);
      } else {
        newSet.add(kpiId);
      }
      return newSet;
    });
  };

  const moveKpi = (index: number, direction: 'up' | 'down') => {
    setEditableKpiOrder(prevOrder => {
      const newOrder = [...prevOrder];
      const kpiToMove = newOrder[index];
      if (direction === 'up' && index > 0) {
        newOrder.splice(index, 1);
        newOrder.splice(index - 1, 0, kpiToMove);
      } else if (direction === 'down' && index < newOrder.length - 1) {
        newOrder.splice(index, 1);
        newOrder.splice(index + 1, 0, kpiToMove);
      }
      return newOrder;
    });
  };

  const handleSave = () => {
    const newVisibleIds = Array.from(selectedKpiIds);
    onSavePreferences({
      visibleKpiIds: newVisibleIds,
      kpiOrder: editableKpiOrder,
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-6 border-b">
          <SheetTitle>{t('home_kpi_customize_sheet_title')}</SheetTitle>
          <SheetDescription>{t('home_kpi_customize_sheet_desc_reorder')}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-grow p-6 space-y-1">
          <p className="text-sm font-medium mb-2">{t('home_kpi_customize_select_label')}:</p>
          {editableKpiOrder.map((kpiId, index) => {
            const kpi = allKpis.find(k => k.id === kpiId);
            if (!kpi) return null;
            return (
              <div key={kpi.id} className="flex items-center space-x-2 p-2 hover:bg-muted/50 rounded-md group">
                <div className="flex flex-col gap-1 mr-2"> {/* Container for arrow buttons on the left */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveKpi(index, 'up')}
                    disabled={index === 0}
                    className="h-7 w-7 p-1 opacity-70 group-hover:opacity-100 disabled:opacity-30"
                    aria-label={t('move_up_button')}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveKpi(index, 'down')}
                    disabled={index === editableKpiOrder.length - 1}
                    className="h-7 w-7 p-1 opacity-70 group-hover:opacity-100 disabled:opacity-30"
                    aria-label={t('move_down_button')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Checkbox
                  id={`kpi-toggle-${kpi.id}`}
                  checked={selectedKpiIds.has(kpi.id)}
                  onCheckedChange={() => handleToggleKpi(kpi.id)}
                />
                <Label htmlFor={`kpi-toggle-${kpi.id}`} className="flex-1 text-sm font-normal cursor-pointer">
                  {t(kpi.titleKey)}
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
