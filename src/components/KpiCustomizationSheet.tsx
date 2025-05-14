
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
import type { KpiConfig } from '@/app/page'; // Adjust path as necessary
import { useTranslation } from '@/hooks/useTranslation';
import { GripVertical, Save, X } from 'lucide-react';

interface KpiCustomizationSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  allKpis: KpiConfig[];
  currentVisibleKpiIds: string[];
  currentKpiOrder: string[]; // We'll use this for reordering later
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
  const [selectedKpiIds, setSelectedKpiIds] = useState<Set<string>>(new Set(currentVisibleKpiIds));
  // For now, kpiOrder editing is not implemented in this step, so we'll just pass it through
  const [editableKpiOrder, setEditableKpiOrder] = useState<string[]>(currentKpiOrder);


  useEffect(() => {
    if (isOpen) {
      setSelectedKpiIds(new Set(currentVisibleKpiIds));
      setEditableKpiOrder(currentKpiOrder);
    }
  }, [isOpen, currentVisibleKpiIds, currentKpiOrder]);

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

  const handleSave = () => {
    // For now, we only save visibility. Order remains as initially loaded.
    // Reordering logic will update `editableKpiOrder` in a future step.
    const newVisibleIds = Array.from(selectedKpiIds);
    // Ensure the order reflects only the currently visible KPIs and maintains their original relative order
    // or the potentially reordered state if/when drag-and-drop is added.
    const newOrder = allKpis.filter(kpi => newVisibleIds.includes(kpi.id)).map(kpi => kpi.id);

    onSavePreferences({
      visibleKpiIds: newVisibleIds,
      kpiOrder: newOrder, // Or editableKpiOrder if reordering is implemented
    });
    onOpenChange(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-6 border-b">
          <SheetTitle>{t('home_kpi_customize_sheet_title')}</SheetTitle>
          <SheetDescription>{t('home_kpi_customize_sheet_desc')}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-grow p-6 space-y-4">
          <p className="text-sm font-medium mb-2">{t('home_kpi_customize_select_label')}:</p>
          {allKpis.map((kpi) => (
            <div key={kpi.id} className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-md">
              {/* Icon for drag handle - reordering to be implemented later */}
              {/* <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" /> */}
              <Checkbox
                id={`kpi-toggle-${kpi.id}`}
                checked={selectedKpiIds.has(kpi.id)}
                onCheckedChange={() => handleToggleKpi(kpi.id)}
              />
              <Label htmlFor={`kpi-toggle-${kpi.id}`} className="flex-1 text-sm font-normal cursor-pointer">
                {t(kpi.titleKey)}
              </Label>
            </div>
          ))}
           {/* Placeholder for reordering UI - to be added later */}
           {/* <p className="text-xs text-muted-foreground mt-4">{t('home_kpi_customize_reorder_soon')}</p> */}
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
