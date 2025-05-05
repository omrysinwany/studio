// src/ai/flows/scan-invoice.ts
'use server';
/**
 * @fileOverview A flow to scan invoices using Gemini and extract product information.
 *
 * - scanInvoice - A function that handles the invoice scanning process.
 * - ScanInvoiceInput - The input type for the scanInvoice function.
 * - ScanInvoiceOutput - The return type for the scanInvoice function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const ScanInvoiceInputSchema = z.object({
  invoiceDataUri: z
    .string()
    .describe(
      "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ScanInvoiceInput = z.infer<typeof ScanInvoiceInputSchema>;

const ScanInvoiceOutputSchema = z.object({
  products: z.array(
    z.object({
      catalogNumber: z.string().describe('The catalog number of the product.'),
      description: z.string().describe('The description of the product.'),
      quantity: z.number().describe('The quantity of the product.'),
      unitPrice: z.number().describe('The unit price of the product.'),
      lineTotal: z.number().describe('The line total for the product.'),
    })
  ).describe('The list of products extracted from the invoice.'),
});
export type ScanInvoiceOutput = z.infer<typeof ScanInvoiceOutputSchema>;

export async function scanInvoice(input: ScanInvoiceInput): Promise<ScanInvoiceOutput> {
  return scanInvoiceFlow(input);
}

const prompt = ai.definePrompt({
  name: 'scanInvoicePrompt',
  input: {
    schema: z.object({
      invoiceDataUri: z
        .string()
        .describe(
          "A photo of an invoice, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
        ),
    }),
  },
  output: {
    schema: z.object({
      products: z.array(
        z.object({
          catalogNumber: z.string().describe('The catalog number of the product.'),
          description: z.string().describe('The description of the product.'),
          quantity: z.number().describe('The quantity of the product.'),
          unitPrice: z.number().describe('The unit price of the product.'),
          lineTotal: z.number().describe('The line total for the product.'),
        })
      ).describe('The list of products extracted from the invoice.'),
    }),
  },
  prompt: `You are an expert in extracting data from invoices. Extract the product details from the invoice image provided. Return a json array of products with fields catalogNumber, description, quantity, unitPrice, and lineTotal.

Invoice Image: {{media url=invoiceDataUri}}`,
});

const scanInvoiceFlow = ai.defineFlow<
  typeof ScanInvoiceInputSchema,
  typeof ScanInvoiceOutputSchema
>({
  name: 'scanInvoiceFlow',
  inputSchema: ScanInvoiceInputSchema,
  outputSchema: ScanInvoiceOutputSchema,
}, async input => {
  const {output} = await prompt(input);
  return output!;
});

