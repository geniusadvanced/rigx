import { NextRequest, NextResponse } from 'next/server';
import { getDocumentExtractionProvider } from '@/features/jobs/services/documentExtractionProviders';
import type { JobDocument } from '@/features/jobs/types';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';

interface ExtractDocumentRequest {
  documentId?: string;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

async function assertAdminOrManager(request: NextRequest): Promise<string> {
  const token = getBearerToken(request);
  if (!token) throw new Error('Authentication token is required');

  const decodedToken = await adminAuth.verifyIdToken(token);
  const callerProfile = await adminDb.collection('users').doc(decodedToken.uid).get();
  const role = callerProfile.data()?.role;

  if (role !== 'admin' && role !== 'manager') {
    throw new Error('Admin or manager access required');
  }

  return decodedToken.uid;
}

export async function POST(request: NextRequest) {
  try {
    const actorId = await assertAdminOrManager(request);
    const body = (await request.json()) as ExtractDocumentRequest;
    const documentId = body.documentId?.trim();

    if (!documentId) {
      return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    const documentSnapshot = await adminDb.collection('documents').doc(documentId).get();
    if (!documentSnapshot.exists) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const documentData = {
      documentId: documentSnapshot.id,
      ...(documentSnapshot.data() as Omit<JobDocument, 'documentId'>),
    };
    const provider = getDocumentExtractionProvider();
    const result = await provider.extractFromDocument(documentData);

    await adminDb.collection('job_document_extractions').doc(documentId).set(
      {
        documentId,
        jobId: documentData.jobId,
        documentType: documentData.type,
        extractedData: result.extractedData,
        status: 'draft',
        verified: false,
        provider: result.provider,
        extractionWarnings: result.warnings || [],
        rawResult: result.rawResult || {},
        extractedBy: actorId,
        extractedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const savedExtraction = await adminDb.collection('job_document_extractions').doc(documentId).get();

    return NextResponse.json({
      extractionId: savedExtraction.id,
      ...savedExtraction.data(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to extract document data';
    const status = message.includes('access') || message.includes('Authentication token') ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
