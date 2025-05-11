// src/components/accounts/AddCategoryDialog.tsx
'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface AddCategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAddCategory: (categoryName: string) => void;
}

const AddCategoryDialog: React.FC<AddCategoryDialogProps> = ({
  isOpen,
  onOpenChange,
  onAddCategory,
}) => {
  const { t } = useTranslation();
  const [categoryName, setCategoryName] = useState('');

  const handleSubmit = () => {
    if (categoryName.trim()) {
      onAddCategory(categoryName.trim());
      setCategoryName(''); // Reset after adding
    }
  };

  const handleClose = () => {
    setCategoryName('');
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <PlusCircle className="mr-2 h-5 w-5 text-primary" />
            {t('accounts_add_category_dialog_title')}
          </DialogTitle>
          <DialogDescription>
            {t('accounts_add_category_dialog_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="categoryName" className="text-right col-span-1">
              {t('accounts_add_category_name_label')}
            </Label>
            <Input
              id="categoryName"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              className="col-span-3"
              placeholder={t('accounts_add_category_name_placeholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" /> {t('cancel_button')}
          </Button>
          <Button onClick={handleSubmit} disabled={!categoryName.trim()}>
            <PlusCircle className="mr-2 h-4 w-4" /> {t('accounts_add_category_button_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddCategoryDialog;
