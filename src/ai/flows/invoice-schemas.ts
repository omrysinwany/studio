// src/ai/flows/invoice-schemas.ts
import { z } from 'genkit';

// Input schema for the AI flow
export const ScanInvoiceInputSchema = z.object({
  invoiceDataUri: z
    .string()
    .describe(
      "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});

// Schema for the raw product data expected from the AI prompt
// IMPORTANT: Keep this aligned with the keys requested in the prompt
export const ExtractedProductSchema = z.object({
  product_name: z.string().optional().describe("The name/description of the product."),
  catalog_number: z.string().optional().describe('The catalog number of the product.'),
  barcode: z.string().optional().describe('The barcode (EAN/UPC) of the product, if visible.'),
  quantity: z.number().describe('The quantity of the product (individual units).'),
  purchase_price: z.number().optional().describe('The extracted purchase price (unit price if available).'),
  sale_price: z.number().optional().describe('The extracted sale price (unit price if available).'), // Added sale_price
  total: z.number().describe('The line total for the product.'),
  description: z.string().optional().describe('Optional description if clearly present.'),
  short_product_name: z.string().optional().describe("A short, concise name or keyword summary for the product (max 3-4 words)."),
});

// Final processed product schema (used for saving and editing)
export const FinalProductSchema = z.object({
  catalogNumber: z.string().describe('The catalog number of the product.'),
  barcode: z.string().optional().describe('The barcode (EAN/UPC) of the product.'),
  description: z.string().describe('The description of the product.'),
  shortName: z.string().optional().describe("A short, concise name for the product."),
  quantity: z.number().describe('The quantity of the product (individual units).'),
  unitPrice: z.number().describe('The calculated unit price (total / quantity or fallback).'),
  salePrice: z.number().optional().describe('The sale price of the product.'), // Added salePrice
  lineTotal: z.number().describe('The line total for the product.'),
  minStockLevel: z.number().optional().describe('Minimum stock level for the product.'),
  maxStockLevel: z.number().optional().describe('Maximum stock level for the product.'),
});

// Final output schema for the entire flow, containing processed products and invoice details
export const ScanInvoiceOutputSchema = z.object({
  products: z.array(FinalProductSchema)
    .describe('The list of products extracted and processed from the invoice.'),
  invoiceNumber: z.string().optional().describe("The extracted invoice number from the document."),
  supplier: z.string().optional().describe("The extracted supplier name from the document."),
  totalAmount: z.number().optional().describe("The extracted final total amount from the document."),
  error: z.string().optional().describe('An error message if the scan or processing failed.'),
});
