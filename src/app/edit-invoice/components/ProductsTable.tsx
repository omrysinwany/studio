// src/app/edit-invoice/components/ProductsTable.tsx
import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, PlusCircle } from "lucide-react";
import type { EditableProduct } from "../types"; // ודא שהנתיב נכון

interface ProductsTableProps {
  products: EditableProduct[];
  handleInputChange: (
    id: string,
    field: keyof EditableProduct,
    value: string | number
  ) => void;
  isSaving: boolean;
  isEditing: boolean;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const formatDisplayValue = (
  value: number | undefined | null,
  fieldType: "currency" | "quantity",
  t: ProductsTableProps["t"]
): string => {
  if (value === undefined || value === null || isNaN(value)) {
    return fieldType === "currency" ? `${t("currency_symbol")}0.00` : "0";
  }
  if (fieldType === "currency") {
    return `${t("currency_symbol")}${parseFloat(String(value)).toFixed(2)}`;
  }
  return String(Math.round(value));
};

const formatInputValue = (
  value: number | undefined | null,
  fieldType: "currency" | "quantity"
): string => {
  if (fieldType === "currency" && (value === undefined || value === null)) {
    return "";
  }
  if (value === null || value === undefined || isNaN(value)) {
    return fieldType === "currency" ? "0.00" : "0";
  }
  if (fieldType === "currency") {
    return parseFloat(String(value)).toFixed(2);
  }
  return String(Math.round(value));
};

export function ProductsTable({
  products,
  handleInputChange,
  isSaving,
  isEditing,
  onAddRow,
  onRemoveRow,
  t,
}: ProductsTableProps) {
  if (products.length === 0 && !isEditing) {
    return (
      <p className="text-muted-foreground py-4">
        {t("edit_invoice_no_products_in_scan")}
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto relative border rounded-md bg-card">
        <Table className="min-w-full sm:min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 sm:px-4 py-2">
                {t("edit_invoice_th_catalog")}
              </TableHead>
              <TableHead className="px-2 sm:px-4 py-2">
                {t("edit_invoice_th_description")}
              </TableHead>
              <TableHead className="text-right px-2 sm:px-4 py-2">
                {t("edit_invoice_th_qty")}
              </TableHead>
              <TableHead className="text-right px-2 sm:px-4 py-2">
                {t("edit_invoice_th_unit_price", {
                  currency_symbol: t("currency_symbol"),
                })}
              </TableHead>
              <TableHead className="text-right px-2 sm:px-4 py-2">
                {t("edit_invoice_th_line_total", {
                  currency_symbol: t("currency_symbol"),
                })}
              </TableHead>
              <TableHead className="text-right px-2 sm:px-4 py-2">
                {isEditing ? t("edit_invoice_th_actions") : ""}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="px-2 sm:px-4 py-2 max-w-[100px] sm:max-w-xs truncate">
                  {isEditing ? (
                    <Input
                      value={product.catalogNumber || ""}
                      onChange={(e) =>
                        handleInputChange(
                          product.id,
                          "catalogNumber",
                          e.target.value
                        )
                      }
                      className="h-9"
                      disabled={isSaving}
                    />
                  ) : (
                    <span title={product.catalogNumber || undefined}>
                      {product.catalogNumber || "N/A"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-2 sm:px-4 py-2 max-w-[150px] sm:max-w-md truncate">
                  {isEditing ? (
                    <Input
                      value={product.description || ""}
                      onChange={(e) =>
                        handleInputChange(
                          product.id,
                          "description",
                          e.target.value
                        )
                      }
                      className="h-9"
                      disabled={isSaving}
                    />
                  ) : (
                    <span title={product.description || undefined}>
                      {product.description || "N/A"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right px-2 sm:px-4 py-2">
                  {isEditing ? (
                    <Input
                      type="number"
                      value={formatInputValue(product.quantity, "quantity")}
                      onChange={(e) =>
                        handleInputChange(
                          product.id,
                          "quantity",
                          e.target.value
                        )
                      }
                      className="w-20 sm:w-24 text-right h-9"
                      disabled={isSaving}
                    />
                  ) : (
                    <span>
                      {formatDisplayValue(product.quantity, "quantity", t)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right px-2 sm:px-4 py-2">
                  {isEditing ? (
                    <Input
                      type="number"
                      value={formatInputValue(product.unitPrice, "currency")}
                      onChange={(e) =>
                        handleInputChange(
                          product.id,
                          "unitPrice",
                          e.target.value
                        )
                      }
                      className="w-24 sm:w-28 text-right h-9"
                      disabled={isSaving}
                    />
                  ) : (
                    <span>
                      {formatDisplayValue(product.unitPrice, "currency", t)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right px-2 sm:px-4 py-2">
                  {isEditing ? (
                    <Input
                      type="number"
                      value={formatInputValue(product.lineTotal, "currency")}
                      onChange={(e) =>
                        handleInputChange(
                          product.id,
                          "lineTotal",
                          e.target.value
                        )
                      }
                      className="w-24 sm:w-28 text-right h-9"
                      disabled={isSaving}
                    />
                  ) : (
                    <span>
                      {formatDisplayValue(product.lineTotal, "currency", t)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right px-2 sm:px-4 py-2">
                  {isEditing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveRow(product.id)}
                      className="text-destructive hover:text-destructive/80 h-8 w-8"
                      disabled={isSaving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {isEditing && (
        <div className="flex justify-start items-center pt-4 mt-4 border-t">
          <Button variant="outline" onClick={onAddRow} disabled={isSaving}>
            <PlusCircle className="mr-2 h-4 w-4" />{" "}
            {t("edit_invoice_add_row_button")}
          </Button>
        </div>
      )}
    </>
  );
}
