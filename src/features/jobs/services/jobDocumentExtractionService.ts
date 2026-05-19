import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/init';
import type {
  JobDocumentExtractedData,
  JobDocumentExtraction,
} from '../types';

interface ExtractDocumentDataParams {
  documentId: string;
  extractedBy: string;
}

interface UpdateDocumentExtractionParams {
  documentId: string;
  extractedData: JobDocumentExtractedData;
  updatedBy: string;
}

interface ApproveDocumentExtractionParams {
  documentId: string;
  verifiedBy: string;
}

function mapExtraction(extractionId: string, data: Record<string, unknown>): JobDocumentExtraction {
  return {
    ...(data as Omit<JobDocumentExtraction, 'extractionId'>),
    extractionId,
  };
}

export async function getJobDocumentExtractions(jobId: string): Promise<JobDocumentExtraction[]> {
  const operationName = 'getJobDocumentExtractions';
  console.log('[DEBUG READ]', operationName, 'job_document_extractions', {
    filters: [['jobId', '==', jobId]],
    jobId,
  });

  try {
    const snapshot = await getDocs(query(collection(db, 'job_document_extractions'), where('jobId', '==', jobId)));
    return snapshot.docs.map((extractionSnapshot) => mapExtraction(extractionSnapshot.id, extractionSnapshot.data()));
  } catch (error) {
    console.error('[PERMISSION ERROR]', operationName, error);
    throw error;
  }
}

export async function getDocumentExtraction(documentId: string): Promise<JobDocumentExtraction | null> {
  const operationName = 'getDocumentExtraction';
  console.log('[DEBUG READ]', operationName, `job_document_extractions/${documentId}`, { documentId });

  try {
    const snapshot = await getDoc(doc(db, 'job_document_extractions', documentId));
    if (!snapshot.exists()) return null;
    return mapExtraction(snapshot.id, snapshot.data());
  } catch (error) {
    console.error('[PERMISSION ERROR]', operationName, error);
    throw error;
  }
}

export async function extractDocumentData(params: ExtractDocumentDataParams): Promise<JobDocumentExtraction> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication is required for document extraction');

  const response = await fetch('/api/jobs/extract-document', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documentId: params.documentId,
      extractedBy: params.extractedBy,
    }),
  });

  const body = (await response.json()) as JobDocumentExtraction | { error?: string };

  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : 'Unable to extract document data');
  }

  return body as JobDocumentExtraction;
}

export async function updateDocumentExtraction(params: UpdateDocumentExtractionParams): Promise<void> {
  await updateDoc(doc(db, 'job_document_extractions', params.documentId), {
    extractedData: params.extractedData,
    status: 'draft',
    verified: false,
    updatedBy: params.updatedBy,
    updatedAt: serverTimestamp(),
  });
}

export async function approveDocumentExtraction(params: ApproveDocumentExtractionParams): Promise<void> {
  await updateDoc(doc(db, 'job_document_extractions', params.documentId), {
    status: 'verified',
    verified: true,
    verifiedBy: params.verifiedBy,
    verifiedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
