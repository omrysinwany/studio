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
  // Ensure quantity, purchase_price, and total are correctly handled as numbers, even if optional
  quantity: z.number().describe('The quantity of the product (individual units).'), // Assuming prompt forces this to be a number
  purchase_price: z.number().optional().describe('The extracted purchase price (unit price if available).'), // Optional purchase price
  total: z.number().describe('The line total for the product.'), // Assuming prompt forces this to be a number
  description: z.string().optional().describe('Optional description if clearly present.'),
});

// Final processed product schema (used for saving and editing)
export const FinalProductSchema = z.object({
  catalogNumber: z.string().describe('The catalog number of the product.'),
  description: z.string().describe('The description of the product.'),
  quantity: z.number().describe('The quantity of the product (individual units).'),
  unitPrice: z.number().describe('The calculated unit price (total / quantity or fallback).'), // Calculated or fallback
  lineTotal: z.number().describe('The line total for the product.'),
});

// Final output schema for the entire flow, containing processed products
export const ScanInvoiceOutputSchema = z.object({
  products: z.array(FinalProductSchema) // Use the final, processed schema here
    .describe('The list of products extracted and processed from the invoice.'),
});
