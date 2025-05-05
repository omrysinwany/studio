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
import type { FinalProductSchema, ExtractedProductSchema } from './invoice-schemas'; // Import schemas
import { ScanInvoiceInputSchema, ScanInvoiceOutputSchema } from './invoice-schemas'; // Import Zod schemas


// Re-export types for external use if needed by components
export type { ScanInvoiceInput, ScanInvoiceOutput, FinalProductSchema };


export async function scanInvoice(input: ScanInvoiceInput): Promise<ScanInvoiceOutput> {
  return scanInvoiceFlow(input);
}


// Updated prompt based on user request
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
    // Output schema from AI matches the extraction request
    schema: z.object({
        products: z.array(ExtractedProductSchema) // Use the Zod schema defined in invoice-schemas.ts
                 .describe('Raw extracted product list from the invoice.'),
    })
  },
  // Updated prompt to prioritize unit quantity
  prompt: `
    Analyze the following image and extract information for ALL distinct products found.
    Provide the extracted data as a JSON **array** (list) of JSON objects.
    Each JSON object in the array should represent a single product and contain the following keys:
    "product_name",
    "catalog_number",
    "quantity",
    "purchase_price",
    "total",
    "description" (include this key only if a description is clearly present for that specific product).

    **IMPORTANT for "quantity":** If there are multiple columns indicating quantity (e.g., one for "Units"/'יח'/'כמות' and another for "Cases"/'ארגזים'/'קרטונים'), ALWAYS extract the value from the column representing **individual units**.

    For the keys "quantity", "purchase_price", and "total", extract ONLY the numerical value (integers or decimals).
    **DO NOT** include any currency symbols (like $, ₪, EUR), commas (unless they are decimal separators if applicable), or any other non-numeric text in the values for these three keys.

    If a specific piece of information (other than description) for a product is not found, you can omit that key from that product's JSON object.
    Ensure the output is a valid JSON array.
    If no products are found, return an empty JSON array [].

    Invoice Image: {{media url=invoiceDataUri}}
  `,
});


const scanInvoiceFlow = ai.defineFlow<
  typeof ScanInvoiceInputSchema,
  typeof ScanInvoiceOutputSchema // Output is the final processed schema
>({
  name: 'scanInvoiceFlow',
  inputSchema: ScanInvoiceInputSchema,
  outputSchema: ScanInvoiceOutputSchema, // Ensure flow output matches final schema
}, async input => {
    let rawOutput: { products: any[] } | null = null; // Initialize rawOutput
    try {
        // Call the prompt to get raw extracted data
        const { output } = await prompt(input);

        // Basic validation of the output structure
        // Use Zod schema to parse and validate the structure more reliably
        const validationResult = z.object({ products: z.array(ExtractedProductSchema) }).safeParse(output);

        if (validationResult.success) {
            rawOutput = validationResult.data; // Use validated data
        } else {
            console.error('AI did not return the expected { products: [...] } structure or validation failed. Received:', output, 'Errors:', validationResult.error);
            // Fallback to empty products if structure is wrong or validation fails
            return { products: [] };
        }

    } catch (promptError) {
        console.error('Error calling AI prompt:', promptError);
        // Return empty products on prompt error
        return { products: [] };
    }

    // Process the raw data: calculate unitPrice and map to final schema
    try {
        const processedProducts = rawOutput.products // Use the validated rawOutput
            .map((rawProduct) => {
                // The Zod schema already validated the structure and types,
                // but we still need to handle potential variations and calculate unitPrice.

                // Defensive parsing just in case Zod validation missed edge cases or types are loose
                const quantity = rawProduct.quantity ?? 0; // quantity is now guaranteed to be a number by Zod
                const lineTotal = rawProduct.total ?? 0; // total is now guaranteed to be a number by Zod
                const purchasePrice = rawProduct.purchase_price ?? 0; // purchase_price is optional number

                // Calculate unit price based on extracted total and quantity
                // Prefer calculation, fallback to purchase_price, then 0
                const unitPrice = quantity !== 0 && lineTotal !== 0
                               ? parseFloat((lineTotal / quantity).toFixed(2))
                               : purchasePrice;


                // Use product_name if available, otherwise fallback to description or catalog number
                const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';

                // Construct the final product object conforming to FinalProductSchema
                const finalProduct: z.infer<typeof FinalProductSchema> = {
                    catalogNumber: rawProduct.catalog_number || 'N/A',
                    description: description,
                    quantity: quantity, // Use parsed quantity
                    unitPrice: unitPrice, // Use calculated or fallback unit price
                    lineTotal: lineTotal, // Use parsed lineTotal
                };
                return finalProduct;
            })
             // No need to filter nulls as Zod ensures array elements match the schema
            .filter(product => product.catalogNumber !== 'N/A' || product.description !== 'Unknown Product'); // Keep existing filter logic if desired

        return { products: processedProducts };

    } catch (processingError) {
         console.error('Error processing AI output:', processingError, 'Raw Output:', rawOutput);
         // Return empty products if processing fails
         return { products: [] };
    }
});
