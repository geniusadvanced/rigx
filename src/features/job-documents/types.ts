import type { Timestamp } from 'firebase/firestore';

export type JobDocumentRecordType = 'service_report' | 'warranty' | 'attachment';
export type WarrantyPeriodType = '7_days' | '1_month' | '3_months' | '6_months' | '12_months';
export type WarrantyClaimLimit = 'unlimited_within_period';

export interface JobDocumentRecord {
  documentId: string;
  jobId: string;
  jobSheetNo: string;
  type: JobDocumentRecordType;
  title: string;
  description: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  warrantyPeriodType?: WarrantyPeriodType | null;
  warrantyPeriodDays: number | null;
  warrantyStartDate: Timestamp | null;
  warrantyEndDate: Timestamp | null;
  warrantyPolicyText?: string;
  warrantyClaimLimit?: WarrantyClaimLimit | null;
  publicWarrantyToken?: string;
  publicWarrantyTokenCreatedAt?: Timestamp;
  publicWarrantyTokenStatus?: 'active' | 'revoked';
  warrantySignedAt?: Timestamp;
  warrantySignedName?: string;
  warrantySignedPhone?: string;
  warrantySignatureDataUrl?: string;
  warrantyTypedSignature?: string;
  acceptedTerms?: boolean;
  warrantySignatureTokenUsed?: string;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateJobDocumentInput {
  jobId: string;
  jobSheetNo: string;
  type: JobDocumentRecordType;
  title: string;
  description: string;
  warrantyPeriodType?: WarrantyPeriodType | null;
  warrantyPeriodDays?: number | null;
  warrantyStartDate?: string;
  file?: File | null;
}
