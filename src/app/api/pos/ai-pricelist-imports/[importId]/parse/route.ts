import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { adminAuth, adminBucket, adminDb, FieldValue } from '@/lib/firebase/admin';
import type { PriceItemType } from '@/features/pos/types';

const allowedTypes: PriceItemType[] = ['service', 'part', 'package', 'diagnostic', 'labor'];
type ParserMode = 'raw_text' | 'image_vision' | 'pdf_text' | 'unavailable';

interface ExistingPriceItem {
  priceItemId: string;
  name?: string;
  category?: string;
  type?: string;
}

interface RawDetectedItem {
  rawText: string;
  suggestedName: string;
  suggestedCategory?: string;
  suggestedType?: string;
  suggestedPrice: number;
  suggestedWarrantyDurationDays?: number;
  suggestedCostPrice?: number;
  confidenceScore: number;
  warnings?: string[];
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

async function assertAdminOrManager(request: NextRequest): Promise<{ uid: string; displayName: string }> {
  const token = getBearerToken(request);
  if (!token) throw new Error('Authentication token is required');

  const decodedToken = await adminAuth.verifyIdToken(token);
  const profileSnapshot = await adminDb.collection('users').doc(decodedToken.uid).get();
  const profile = profileSnapshot.data() || {};
  if (profile.role !== 'admin' && profile.role !== 'manager') {
    throw new Error('Admin or manager access required');
  }

  return {
    uid: decodedToken.uid,
    displayName: String(profile.displayName || profile.name || decodedToken.name || 'Unknown User'),
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function similarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalize(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function inferType(text: string): PriceItemType {
  const normalized = normalize(text);
  if (normalized.includes('diagnostic') || normalized.includes('checking')) return 'diagnostic';
  if (normalized.includes('labor') || normalized.includes('labour') || normalized.includes('service charge')) return 'labor';
  if (normalized.includes('package') || normalized.includes('bundle')) return 'package';
  if (/(screen|battery|keyboard|ssd|hdd|ram|charger|hinge|casing|board|chip|ic|fan|speaker|camera|part)/.test(normalized)) return 'part';
  return 'service';
}

function inferCategory(text: string): string {
  const normalized = normalize(text);
  if (normalized.includes('data recovery')) return 'data_recovery';
  if (normalized.includes('motherboard') || normalized.includes('board') || normalized.includes('chip') || normalized.includes('ic')) return 'motherboard';
  if (normalized.includes('screen') || normalized.includes('lcd')) return 'screen';
  if (normalized.includes('battery')) return 'battery';
  if (normalized.includes('keyboard')) return 'keyboard';
  if (normalized.includes('ssd') || normalized.includes('hdd') || normalized.includes('storage')) return 'storage';
  if (normalized.includes('ram')) return 'ram';
  if (normalized.includes('diagnostic') || normalized.includes('checking')) return 'diagnostic';
  return 'general';
}

function extractWarrantyDays(text: string): number {
  const normalized = text.toLowerCase();
  const monthMatch = normalized.match(/(\d+)\s*(month|months|bulan)/);
  if (monthMatch) return Number(monthMatch[1]) * 30;
  const dayMatch = normalized.match(/(\d+)\s*(day|days|hari)/);
  if (dayMatch) return Number(dayMatch[1]);
  return 0;
}

function extractPrice(line: string): number {
  const matches = Array.from(line.matchAll(/(?:rm\s*)?(\d{1,6}(?:[,.]\d{1,2})?)/gi));
  if (!matches.length) return 0;
  const last = matches[matches.length - 1]?.[1] || '0';
  return Number(last.replace(',', '.')) || 0;
}

function cleanName(line: string): string {
  return line
    .replace(/rm\s*\d{1,6}(?:[,.]\d{1,2})?/gi, '')
    .replace(/\b\d{1,6}(?:[,.]\d{1,2})?\b\s*$/g, '')
    .replace(/[-–—|:]+$/g, '')
    .trim();
}

async function writeAudit(input: {
  entityId: string;
  action: string;
  actor: { uid: string; displayName: string };
  note: string;
  parserMode?: ParserMode;
  detectedItemCount?: number;
  errorMessage?: string;
  changes?: Array<Record<string, unknown>>;
}) {
  await adminDb.collection('auditLogs').add({
    entityType: 'pos',
    entityId: input.entityId,
    action: input.action,
    changedBy: input.actor.uid,
    changedByDisplayName: input.actor.displayName,
    changes: [
      ...(input.changes || []),
      ...(input.parserMode ? [{ field: 'parserMode', before: null, after: input.parserMode }] : []),
      ...(typeof input.detectedItemCount === 'number' ? [{ field: 'detectedItemCount', before: null, after: input.detectedItemCount }] : []),
      ...(input.errorMessage ? [{ field: 'errorMessage', before: null, after: input.errorMessage }] : []),
    ],
    note: input.note,
    createdAt: FieldValue.serverTimestamp(),
  });
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

  throw new Error('OpenAI response did not include structured pricelist JSON');
}

async function getExistingPriceItems(): Promise<ExistingPriceItem[]> {
  const priceItemsSnapshot = await adminDb.collection('priceItems').where('active', '==', true).get();
  return priceItemsSnapshot.docs.map((itemDoc): ExistingPriceItem => ({ priceItemId: itemDoc.id, ...itemDoc.data() }));
}

function normalizeConfidenceScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric));
}

function normalizeDetectedItems(rawItems: RawDetectedItem[], existingItems: ExistingPriceItem[]) {
  return rawItems.map((rawItem, index) => {
    const warnings = Array.isArray(rawItem.warnings) ? [...rawItem.warnings.map(String)] : [];
    const suggestedName = String(rawItem.suggestedName || '').trim();
    const suggestedCategory = String(rawItem.suggestedCategory || inferCategory(`${rawItem.rawText} ${suggestedName}`)).trim();
    let suggestedType = String(rawItem.suggestedType || inferType(`${rawItem.rawText} ${suggestedName}`)) as PriceItemType;
    if (!allowedTypes.includes(suggestedType)) {
      warnings.push('Invalid type defaulted to service');
      suggestedType = 'service';
    }
    const suggestedPrice = Number(rawItem.suggestedPrice || 0);
    const confidenceScore = normalizeConfidenceScore(rawItem.confidenceScore);
    const duplicate = existingItems
      .map((item) => ({
        priceItemId: String(item.priceItemId),
        score: Math.max(
          similarity(suggestedName, String(item.name || '')),
          similarity(`${suggestedName} ${suggestedCategory} ${suggestedType}`, `${item.name || ''} ${item.category || ''} ${item.type || ''}`),
        ),
      }))
      .sort((left, right) => right.score - left.score)[0];
    const duplicateCandidate = Boolean(duplicate && duplicate.score >= 0.78);

    if (confidenceScore < 85) warnings.push('Low confidence');
    if (duplicateCandidate) warnings.push('Possible duplicate existing price item');
    if (!suggestedCategory) warnings.push('Missing category');
    if (!Number(rawItem.suggestedWarrantyDurationDays || 0)) warnings.push('Missing warranty');
    if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) warnings.push('Invalid price');
    if (!suggestedName) warnings.push('Missing item name');

    const uniqueWarnings = Array.from(new Set(warnings.filter(Boolean)));
    const status = confidenceScore < 85 || suggestedPrice <= 0 || duplicateCandidate || !suggestedName || !suggestedCategory
      ? 'needs_review'
      : 'pending';

    return {
      id: `${Date.now()}_${index}`,
      rawText: String(rawItem.rawText || suggestedName || '').trim(),
      suggestedName,
      suggestedCategory,
      suggestedType,
      suggestedPrice: Number.isFinite(suggestedPrice) ? suggestedPrice : 0,
      suggestedWarrantyDurationDays: Number(rawItem.suggestedWarrantyDurationDays || 0),
      suggestedCostPrice: Number(rawItem.suggestedCostPrice || 0),
      confidenceScore,
      duplicateCandidate,
      matchedExistingPriceItemId: duplicateCandidate ? duplicate?.priceItemId || '' : '',
      warnings: uniqueWarnings,
      status,
    };
  });
}

function parseRawText(rawText: string, existingItems: ExistingPriceItem[]) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3);

  return normalizeDetectedItems(lines.map((line) => {
    const suggestedPrice = extractPrice(line);
    const suggestedName = cleanName(line);
    const warnings: string[] = [];
    if (!suggestedName) warnings.push('Missing item name');
    if (suggestedPrice <= 0) warnings.push('Missing or invalid price');
    const confidenceScore = Math.max(35, Math.min(94,
      55
      + (suggestedName ? 18 : 0)
      + (suggestedPrice > 0 ? 18 : 0)
      + (line.toLowerCase().includes('rm') ? 3 : 0)
      - (warnings.length > 1 ? 10 : 0),
    ));
    return {
      rawText: line,
      suggestedName,
      suggestedCategory: inferCategory(line),
      suggestedType: inferType(line),
      suggestedPrice,
      suggestedWarrantyDurationDays: extractWarrantyDays(line),
      suggestedCostPrice: 0,
      confidenceScore,
      warnings,
    };
  }), existingItems);
}

async function getUploadedImportFile(importId: string, sourceMimeType: string) {
  if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    throw new Error('Firebase Storage bucket is not configured');
  }
  const [files] = await adminBucket.getFiles({ prefix: `ai-pricelist-imports/${importId}/` });
  const file = files[0];
  if (!file) throw new Error('Uploaded pricelist file not found');
  const [buffer] = await file.download();
  return {
    buffer,
    base64: buffer.toString('base64'),
    contentType: String(file.metadata.contentType || sourceMimeType || ''),
    fileName: file.name.split('/').pop() || file.name,
  };
}

function normalizeExtractedPdfText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function parsePdfText(importId: string, sourceMimeType: string, existingItems: ExistingPriceItem[]) {
  const file = await getUploadedImportFile(importId, sourceMimeType);
  if (file.contentType !== 'application/pdf') {
    throw new Error('PDF parser supports PDF uploads only');
  }

  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: file.buffer });
    const result = await parser.getText();
    const rawExtractedText = normalizeExtractedPdfText(result.text || '');
    if (!rawExtractedText || rawExtractedText.length < 10) {
      throw new Error('This PDF appears to be scanned. Please upload screenshot/image or paste text manually.');
    }

    return {
      rawExtractedText,
      detectedItems: parseRawText(rawExtractedText, existingItems),
      aiModel: 'pdf_text_extraction',
    };
  } catch (error) {
    console.warn('[POS AI PRICELIST PARSE WARNING]', JSON.stringify({
      action: 'parse_pdf_pricelist',
      importId,
      fileName: file.fileName,
      fileType: file.contentType,
      errorMessage: error instanceof Error ? error.message : String(error),
    }, null, 2));
    throw error;
  } finally {
    await parser?.destroy();
  }
}

async function parseImageWithOpenAi(importId: string, sourceMimeType: string, existingItems: ExistingPriceItem[]) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Image OCR requires OPENAI_API_KEY. Please paste the text manually or configure OPENAI_API_KEY.');
  }
  const file = await getUploadedImportFile(importId, sourceMimeType);
  if (!['image/jpeg', 'image/png'].includes(file.contentType)) {
    throw new Error('Image OCR supports JPEG and PNG only');
  }

  const model = process.env.OPENAI_PRICELIST_MODEL || process.env.OPENAI_DOCUMENT_MODEL || 'gpt-4.1-mini';
  const prompt = [
    'Return strict JSON only. Extract only real pricelist rows from this Genius Advanced/RIGX repair pricelist image.',
    'Ignore headers, footers, addresses, phone numbers, social media handles, decorative text, and unrelated notes.',
    'Do not invent prices or items. Use Malaysian Ringgit pricing where applicable.',
    'If a price or item name is uncertain, include the row with confidenceScore below 85 and a warning.',
    'suggestedType must be one of service, part, package, diagnostic, labor.',
  ].join(' ');

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
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:${file.contentType};base64,${file.base64}` },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pricelist_import',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rawExtractedText: { type: 'string' },
              detectedItems: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    rawText: { type: 'string' },
                    suggestedName: { type: 'string' },
                    suggestedCategory: { type: 'string' },
                    suggestedType: { type: 'string', enum: ['service', 'part', 'package', 'diagnostic', 'labor'] },
                    suggestedPrice: { type: 'number' },
                    suggestedWarrantyDurationDays: { type: 'number' },
                    suggestedCostPrice: { type: 'number' },
                    confidenceScore: { type: 'number' },
                    warnings: { type: 'array', items: { type: 'string' } },
                  },
                  required: [
                    'rawText',
                    'suggestedName',
                    'suggestedCategory',
                    'suggestedType',
                    'suggestedPrice',
                    'suggestedWarrantyDurationDays',
                    'suggestedCostPrice',
                    'confidenceScore',
                    'warnings',
                  ],
                },
              },
            },
            required: ['rawExtractedText', 'detectedItems'],
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
        : `OpenAI pricelist OCR failed (${response.status})`;
    throw new Error(errorMessage);
  }

  const parsed = parseOpenAiJsonResponse(responseBody);
  const rawItems = Array.isArray(parsed.detectedItems) ? parsed.detectedItems as RawDetectedItem[] : [];
  return {
    rawExtractedText: typeof parsed.rawExtractedText === 'string' ? parsed.rawExtractedText : '',
    detectedItems: normalizeDetectedItems(rawItems, existingItems),
    aiModel: model,
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ importId: string }> }) {
  try {
    const actor = await assertAdminOrManager(request);
    const { importId } = await context.params;
    const importRef = adminDb.collection('aiPricelistImports').doc(importId);
    const importSnapshot = await importRef.get();
    if (!importSnapshot.exists) {
      return NextResponse.json({ error: 'AI pricelist import not found' }, { status: 404 });
    }

    const importData = importSnapshot.data() || {};
    const rawText = String(importData.rawExtractedText || '').trim();
    await importRef.update({
      status: 'processing',
      errorMessage: '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    const existingItems = await getExistingPriceItems();
    const sourceMimeType = String(importData.sourceMimeType || '');
    let parserMode: ParserMode = 'raw_text';
    let detectedItems;
    let nextRawExtractedText = rawText;
    let aiModel = 'manual_text_parser';

    try {
      if (rawText) {
        parserMode = 'raw_text';
        detectedItems = parseRawText(rawText, existingItems);
      } else if (sourceMimeType === 'image/jpeg' || sourceMimeType === 'image/png') {
        parserMode = 'image_vision';
        const result = await parseImageWithOpenAi(importId, sourceMimeType, existingItems);
        detectedItems = result.detectedItems;
        nextRawExtractedText = result.rawExtractedText;
        aiModel = result.aiModel;
      } else if (sourceMimeType === 'application/pdf') {
        parserMode = 'pdf_text';
        const result = await parsePdfText(importId, sourceMimeType, existingItems);
        detectedItems = result.detectedItems;
        nextRawExtractedText = result.rawExtractedText;
        aiModel = result.aiModel;
      } else {
        parserMode = 'unavailable';
        throw new Error('AI parser unavailable. Add raw text, upload a JPEG/PNG screenshot, or configure OPENAI_API_KEY.');
      }
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unable to parse AI pricelist import';
      await importRef.update({
        status: 'failed',
        errorMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit({
        entityId: importId,
        action: 'pos_ai_pricelist_import_failed',
        actor,
        note: errorMessage,
        parserMode,
        detectedItemCount: 0,
        errorMessage,
        changes: [{ field: 'status', before: importData.status || 'uploaded', after: 'failed' }],
      });
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    await importRef.update({
      status: 'parsed',
      detectedItems,
      rawExtractedText: nextRawExtractedText,
      aiModel,
      errorMessage: '',
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({
      entityId: importId,
      action: 'pos_ai_pricelist_import_parsed',
      actor,
      note: parserMode === 'image_vision'
        ? 'AI pricelist import parsed from uploaded image'
        : parserMode === 'pdf_text'
          ? 'AI pricelist import parsed from uploaded PDF text'
          : 'AI pricelist import parsed from pasted text',
      parserMode,
      detectedItemCount: detectedItems.length,
      changes: [{ field: 'detectedItems', before: 0, after: detectedItems.length }],
    });

    const latestSnapshot = await importRef.get();
    return NextResponse.json({ importId: latestSnapshot.id, ...latestSnapshot.data() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse AI pricelist import';
    const status = message.includes('access') || message.includes('Authentication token') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
