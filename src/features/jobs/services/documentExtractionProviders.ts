import 'server-only';

import type {
  DocumentExtractionProviderName,
  ExtractionResult,
  JobDocument,
  JobDocumentExtractedData,
  JobDocumentType,
} from '../types';

export interface DocumentExtractionProvider {
  name: DocumentExtractionProviderName;
  extractFromDocument(document: JobDocument): Promise<ExtractionResult>;
}

const supportedContentTypes = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const maxDownloadBytes = 10 * 1024 * 1024;

function createMockExtractedData(document: JobDocument): JobDocumentExtractedData {
  const amount = Number.isFinite(Number(document.amount)) && Number(document.amount) > 0 ? Number(document.amount) : null;

  return {
    amount,
    date: '',
    supplierName: '',
    invoiceNumber: '',
    logisticCost: document.type === 'logistic_receipt' ? amount : null,
    inferredType: document.type,
    confidenceScore: 0,
  };
}

function normalizeContentType(contentType: string, fileName = ''): string {
  const cleanContentType = contentType.split(';')[0].trim().toLowerCase();
  if (supportedContentTypes.includes(cleanContentType as (typeof supportedContentTypes)[number])) return cleanContentType;

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';

  return cleanContentType;
}

async function downloadDocument(document: JobDocument): Promise<{ base64: string; contentType: string; fileName: string }> {
  const response = await fetch(document.fileUrl);

  if (!response.ok) {
    throw new Error(`Unable to download document for extraction (${response.status})`);
  }

  const fileName = document.fileName || `${document.documentId}`;
  const contentType = normalizeContentType(response.headers.get('content-type') || '', fileName);

  if (!supportedContentTypes.includes(contentType as (typeof supportedContentTypes)[number])) {
    throw new Error(`Unsupported document content type: ${contentType || 'unknown'}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxDownloadBytes) {
    throw new Error('Document exceeds 10MB extraction limit');
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxDownloadBytes) {
    throw new Error('Document exceeds 10MB extraction limit');
  }

  return {
    base64: Buffer.from(arrayBuffer).toString('base64'),
    contentType,
    fileName,
  };
}

function parseOpenAiJsonResponse(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.output_text === 'string') {
    return JSON.parse(body.output_text) as Record<string, unknown>;
  }

  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    const content = typeof item === 'object' && item && 'content' in item ? item.content : null;
    if (!Array.isArray(content)) continue;

    for (const contentItem of content) {
      if (typeof contentItem !== 'object' || !contentItem || !('text' in contentItem)) continue;
      const text = contentItem.text;
      if (typeof text === 'string') return JSON.parse(text) as Record<string, unknown>;
    }
  }

  throw new Error('OpenAI response did not include structured extraction JSON');
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue =
    typeof value === 'string'
      ? Number(value.replace(/,/g, '').replace(/[^\d.-]/g, ''))
      : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return value;
}

function normalizeConfidence(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(1, numberValue));
}

function normalizeDocumentType(value: unknown, fallback: JobDocumentType): JobDocumentType {
  const allowedTypes: JobDocumentType[] = [
    'checklist',
    'supplier_receipt',
    'logistic_receipt',
    'invoice',
    'payment_receipt',
    'photo',
  ];
  return allowedTypes.includes(value as JobDocumentType) ? (value as JobDocumentType) : fallback;
}

function normalizeOpenAiExtraction(parsed: Record<string, unknown>, document: JobDocument): JobDocumentExtractedData {
  const amount = normalizeNumber(parsed.amount);
  const logisticCost = normalizeNumber(parsed.logisticCost);
  const confidenceScore = amount === null
    ? Math.min(normalizeConfidence(parsed.confidenceScore), 0.35)
    : normalizeConfidence(parsed.confidenceScore);

  return {
    amount,
    date: normalizeDate(parsed.date),
    supplierName: typeof parsed.supplierName === 'string' ? parsed.supplierName : '',
    invoiceNumber: typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber : '',
    logisticCost,
    inferredType: normalizeDocumentType(parsed.inferredType, document.type),
    confidenceScore,
  };
}

function buildOpenAiInputContent(document: JobDocument, file: { base64: string; contentType: string; fileName: string }) {
  const extractionPrompt = [
    'Return strict JSON only. Do not include explanations, markdown, comments, or text outside JSON.',
    'Extract fields from a repair job receipt, invoice, payment receipt, logistic receipt, checklist, or repair photo.',
    `The uploaded document metadata type is ${document.type}.`,
    'Use null for missing numeric values and empty strings for missing text.',
    'Never guess random numbers. If an amount is unclear or unreadable, return amount null and confidenceScore <= 0.35.',
    'Amount means the FINAL TOTAL payable amount only, not subtotal, tax, discount, balance, deposit, change, unit price, or line item amount.',
    'If multiple totals exist, choose the largest amount explicitly labeled Total, Grand Total, Final Total, Amount Due, Total Paid, Paid, or Net Total.',
    'If RM or MYR appears, treat currency as Malaysian Ringgit. Normalize amount as a plain number with no currency symbol and no commas.',
    'Normalize date to YYYY-MM-DD. If the year/month/day is unclear or invalid, return an empty string.',
    'supplierName is the top header or business/vendor name, not the customer name unless no vendor exists.',
    'invoiceNumber is any labeled invoice number, bill number, receipt number, order number, reference number, or ref no.',
    'For logisticCost, only fill it when the document or visible text includes delivery, lalamove, shipping, courier, logistics, rider, or transport cost.',
    'If logistic keywords are absent, logisticCost must be null.',
    'inferredType must be one of the allowed document types and may differ from metadata only if the content clearly proves it.',
    'confidenceScore rules: 0.85-1.0 if a clear final Total label is found; 0.55-0.84 if the amount is inferred from context; 0.0-0.54 if unclear or partial.',
  ].join(' ');

  if (file.contentType === 'application/pdf') {
    return [
      { type: 'input_text', text: extractionPrompt },
      {
        type: 'input_file',
        filename: file.fileName.endsWith('.pdf') ? file.fileName : `${file.fileName}.pdf`,
        file_data: file.base64,
      },
    ];
  }

  return [
    { type: 'input_text', text: extractionPrompt },
    {
      type: 'input_image',
      image_url: `data:${file.contentType};base64,${file.base64}`,
    },
  ];
}

async function callOpenAiVision(document: JobDocument): Promise<ExtractionResult> {
  const file = await downloadDocument(document);
  const model = process.env.OPENAI_DOCUMENT_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: buildOpenAiInputContent(document, file),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'job_document_extraction',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              amount: { type: ['number', 'null'] },
              date: { type: 'string', description: 'YYYY-MM-DD only if valid and visible, otherwise empty string.' },
              supplierName: { type: 'string', description: 'Top header/business/vendor name, otherwise empty string.' },
              invoiceNumber: { type: 'string', description: 'Invoice, receipt, bill, order, or reference number, otherwise empty string.' },
              logisticCost: { type: ['number', 'null'] },
              inferredType: {
                type: 'string',
                enum: ['checklist', 'supplier_receipt', 'logistic_receipt', 'invoice', 'payment_receipt', 'photo'],
              },
              confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: [
              'amount',
              'date',
              'supplierName',
              'invoiceNumber',
              'logisticCost',
              'inferredType',
              'confidenceScore',
            ],
          },
        },
      },
    }),
  });

  const responseBody = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage =
      typeof responseBody.error === 'object' && responseBody.error && 'message' in responseBody.error
        ? String(responseBody.error.message)
        : `OpenAI extraction failed (${response.status})`;
    throw new Error(errorMessage);
  }

  const parsed = parseOpenAiJsonResponse(responseBody);

  return {
    provider: 'openai_vision',
    extractedData: normalizeOpenAiExtraction(parsed, document),
    warnings: ['AI extraction requires admin verification before financial use.'],
    rawResult: {
      responseId: typeof responseBody.id === 'string' ? responseBody.id : '',
      model,
      contentType: file.contentType,
    },
  };
}

const mockProvider: DocumentExtractionProvider = {
  name: 'mock',
  async extractFromDocument(document) {
    return {
      provider: 'mock',
      extractedData: createMockExtractedData(document),
      warnings: ['Mock extraction only. Admin verification is required before use.'],
    };
  },
};

const openAiVisionProvider: DocumentExtractionProvider = {
  name: 'openai_vision',
  async extractFromDocument(document) {
    if (!process.env.OPENAI_API_KEY) {
      return {
        provider: 'mock',
        extractedData: createMockExtractedData(document),
        warnings: ['OPENAI_API_KEY is not configured. Used mock extraction fallback.'],
      };
    }

    try {
      return await callOpenAiVision(document);
    } catch (error) {
      return {
        provider: 'mock',
        extractedData: createMockExtractedData(document),
        warnings: [
          error instanceof Error ? `OpenAI extraction failed: ${error.message}` : 'OpenAI extraction failed',
          'Used mock extraction fallback.',
        ],
      };
    }
  },
};

const googleDocumentAiProvider: DocumentExtractionProvider = {
  name: 'google_document_ai',
  async extractFromDocument(document) {
    return {
      provider: 'mock',
      extractedData: createMockExtractedData(document),
      warnings: ['Google Document AI provider is a placeholder. Used mock extraction fallback.'],
    };
  },
};

export function getDocumentExtractionProvider(): DocumentExtractionProvider {
  const provider = (process.env.DOCUMENT_EXTRACTION_PROVIDER || 'mock') as DocumentExtractionProviderName;

  if (provider === 'openai_vision') return openAiVisionProvider;
  if (provider === 'google_document_ai') return googleDocumentAiProvider;
  return mockProvider;
}
