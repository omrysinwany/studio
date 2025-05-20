import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Save, ArrowLeft } from 'lucide-react';
import type { DialogFlowStep } from '../types'; // Assuming DialogFlowStep is in types

interface PageActionButtonsProps {
  isSaving: boolean;
  isViewMode: boolean;
  isNewScan: boolean;
  currentDialogStep: DialogFlowStep; // To disable save if dialogs are active
  onSave: () => void;
  onGoBack: () => void;
  docType: 'deliveryNote' | 'invoice' | null;
  t: (key: string) => string;
}

export function PageActionButtons({
  isSaving,
  isViewMode,
  isNewScan,
  currentDialogStep,
  onSave,
  onGoBack,
  docType,
  t
}: PageActionButtonsProps) {
  const goBackButtonText = isViewMode
    ? (docType === 'invoice' ? t('edit_invoice_go_back_to_invoices_button') : t('product_detail_back_to_inventory_button'))
    : t('edit_invoice_discard_scan_button');

  const saveButtonText = isNewScan ? t('edit_invoice_confirm_and_save_button') : t('edit_invoice_save_changes_button');
  const isSaveDisabled = isSaving || (isNewScan && currentDialogStep !== 'ready_to_save' && currentDialogStep !== 'idle' /* allow save from idle if no dialogs triggered */);


  return (
    <div className="mt-6 flex flex-col sm:flex-row items-stretch gap-3">
      <Button variant="outline" onClick={onGoBack} className="w-full sm:w-auto order-last sm:order-first" disabled={isSaving}>
        <ArrowLeft className="mr-2 h-4 w-4" /> {goBackButtonText}
      </Button>

      {!isViewMode && (
        <div className="flex-grow flex flex-col sm:flex-row sm:justify-end gap-3">
          <Button
            onClick={onSave}
            disabled={isSaveDisabled}
            className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
          >
            {isSaving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('saving')}...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" /> {saveButtonText}</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}