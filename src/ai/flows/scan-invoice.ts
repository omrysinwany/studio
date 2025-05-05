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

// Updated Schema to reflect the prompt's output keys
const ExtractedProductSchema = z.object({
    product_name: z.string().optional().describe("The name/description of the product."), // Use product_name or description
    catalog_number: z.string().optional().describe('The catalog number of the product.'),
    quantity: z.number().describe('The quantity of the product (individual units).'), // Ensure this specifies units
    purchase_price: z.number().optional().describe('The extracted purchase price (may not be the final unit price).'), // Keep purchase_price if needed
    total: z.number().describe('The line total for the product.'),
    description: z.string().optional().describe('Optional description if clearly present.'), // Optional description
});

// Final output schema with calculated unitPrice
const FinalProductSchema = z.object({
      catalogNumber: z.string().describe('The catalog number of the product.'),
      description: z.string().describe('The description of the product.'),
      quantity: z.number().describe('The quantity of the product (individual units).'), // Specify units
      unitPrice: z.number().describe('The calculated unit price (total / quantity).'), // Calculated field
      lineTotal: z.number().describe('The line total for the product.'),
});


const ScanInvoiceOutputSchema = z.object({
  products: z.array(FinalProductSchema) // Use the final schema here
          .describe('The list of products extracted and processed from the invoice.'),
});
export type ScanInvoiceOutput = z.infer<typeof ScanInvoiceOutputSchema>;


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
        products: z.array(ExtractedProductSchema)
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
    // Call the prompt to get raw extracted data
    const { output: rawOutput } = await prompt(input);

    if (!rawOutput || !rawOutput.products) {
      // Handle cases where AI returns nothing or an invalid structure
      console.error('AI did not return valid product data.');
      return { products: [] };
    }

    // Process the raw data: calculate unitPrice and map to final schema
    const processedProducts = rawOutput.products
        .map((rawProduct) => {
            const quantity = rawProduct.quantity ?? 0; // Default to 0 if missing
            const lineTotal = rawProduct.total ?? 0; // Default to 0 if missing
            // Calculate unit price based on extracted total and quantity
            const unitPrice = quantity !== 0 ? parseFloat((lineTotal / quantity).toFixed(2)) : (rawProduct.purchase_price ?? 0); // Calculate or use purchase_price as fallback


            // Use product_name if available, otherwise fallback to description or catalog number
            const description = rawProduct.product_name || rawProduct.description || rawProduct.catalog_number || 'Unknown Product';

            return {
                catalogNumber: rawProduct.catalog_number || 'N/A',
                description: description,
                quantity: quantity, // This should now be the unit quantity based on the updated prompt
                unitPrice: unitPrice, // Use the calculated or fallback unit price
                lineTotal: lineTotal,
            };
        })
        .filter(product => product.catalogNumber !== 'N/A' || product.description !== 'Unknown Product'); // Filter out potentially empty rows if needed


    return { products: processedProducts };
});
