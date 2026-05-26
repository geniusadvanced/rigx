import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { db } from './init';
import type { Job, UserData } from '@/types';
import { assertCan } from '@/lib/rbac/can';

export const rootCollections = {
  users: 'users',
  jobs: 'jobs',
  customers: 'customers',
  devices: 'devices',
  branches: 'branches',
  documents: 'documents',
  notices: 'notices',
  noticeReads: 'noticeReads',
  leaveEntitlements: 'leaveEntitlements',
  branchChats: 'branchChats',
  branchChatReads: 'branchChatReads',
  partnerJobs: 'partnerJobs',
  attendance: 'attendance',
  commissions: 'commissions',
  auditLogs: 'auditLogs',
  legacyAuditLogs: 'audit_logs',
} as const;

export async function getUserData(uid: string): Promise<UserData | null> {
  const operationName = 'getUserData';
  const path = `users/${uid}`;
  console.log('[DEBUG READ]', operationName, path, { uid });

  try {
    const snapshot = await getDoc(doc(db, rootCollections.users, uid));
    if (!snapshot.exists()) return null;
    return snapshot.data() as UserData;
  } catch (error) {
    console.error('[PERMISSION ERROR]', operationName, error);
    throw error;
  }
}

function normalizeBranchId(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  if (compact === 'bangi') return 'bangi';
  if (compact === 'cyberjaya') return 'cyberjaya';
  return normalized;
}

function userBranchQueryValue(user: UserData): string {
  return normalizeBranchId(user.branchId);
}

export async function getJobsForUser(user: UserData): Promise<Job[]> {
  if (user.role === 'technician') {
    assertCan(user.role, 'jobs.view.assigned');
  } else {
    assertCan(user.role, 'jobs.view.all');
  }

  console.log('Role:', user.role, 'UID:', user.uid);

  const jobsRef = collection(db, rootCollections.jobs);
  if (user.role === 'technician') {
    console.log('[DEBUG READ]', 'getJobsForUser', 'jobs', {
      filters: [['technicianId', '==', user.uid]],
      uid: user.uid,
      role: user.role,
    });
    const technicianJobsQuery = query(jobsRef, where('technicianId', '==', user.uid));
    let snapshot;

    try {
      snapshot = await getDocs(technicianJobsQuery);
    } catch (error) {
      console.error('[PERMISSION ERROR]', 'getJobsForUser', error);
      throw error;
    }

    return snapshot.docs.map((jobDoc) => ({
      docId: jobDoc.id,
      ...(jobDoc.data() as Omit<Job, 'docId'>),
    }));
  }

  if (user.role === 'manager') {
    const branchId = userBranchQueryValue(user);
    if (!branchId) return [];

    console.log('[DEBUG READ]', 'getJobsForUser', 'jobs', {
      filters: [['branchId', '==', branchId]],
      uid: user.uid,
      role: user.role,
      branchId,
    });

    let snapshot;

    try {
      snapshot = await getDocs(query(jobsRef, where('branchId', '==', branchId)));
    } catch (error) {
      console.error('[PERMISSION ERROR]', 'getJobsForUser', error);
      throw error;
    }

    return snapshot.docs.map((jobDoc) => ({
      docId: jobDoc.id,
      ...(jobDoc.data() as Omit<Job, 'docId'>),
    }));
  }

  console.log('[DEBUG READ]', 'getJobsForUser', 'jobs', {
    filters: [],
    uid: user.uid,
    role: user.role,
  });

  let snapshot;

  try {
    snapshot = await getDocs(jobsRef);
  } catch (error) {
    console.error('[PERMISSION ERROR]', 'getJobsForUser', error);
    throw error;
  }

  return snapshot.docs.map((jobDoc) => ({
    docId: jobDoc.id,
    ...(jobDoc.data() as Omit<Job, 'docId'>),
  }));
}

const readableJobReferenceFields = [
  'id',
  'jobId',
  'jobNo',
  'jobNumber',
  'jobSheetNo',
  'agnJobNumber',
  'repairId',
] as const;

function canReadJob(user: UserData, job: Job): boolean {
  if (user.role === 'technician') return job.technicianId === user.uid;
  if (user.role === 'manager') {
    const managerBranch = normalizeBranchId(user.branchId);
    const jobBranch = normalizeBranchId(job.branchId);
    return Boolean(managerBranch && jobBranch && managerBranch === jobBranch);
  }
  return true;
}

async function getJobByDocId(user: UserData, jobId: string): Promise<Job | null> {
  if (jobId.includes('/')) return null;

  const snapshot = await getDoc(doc(db, rootCollections.jobs, jobId)).catch(() => null);
  if (!snapshot) return null;
  if (!snapshot.exists()) return null;

  const job = {
    docId: snapshot.id,
    ...(snapshot.data() as Omit<Job, 'docId'>),
  };
  return canReadJob(user, job) ? job : null;
}

async function getJobIdFromRegistry(jobNo: string): Promise<string | null> {
  if (jobNo.includes('/')) return null;

  const snapshot = await getDoc(doc(db, 'jobNumberRegistry', jobNo));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as { jobId?: unknown; docId?: unknown };
  return String(data.jobId || data.docId || '').trim() || null;
}

export async function getJobForUserByIdentifier(user: UserData, identifier: string): Promise<Job | null> {
  if (user.role === 'technician') {
    assertCan(user.role, 'jobs.view.assigned');
  } else {
    assertCan(user.role, 'jobs.view.all');
  }

  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) return null;
  if (user.role === 'manager' && !userBranchQueryValue(user)) return null;

  const directJob = await getJobByDocId(user, normalizedIdentifier);
  if (directJob) return directJob;

  const registryJobId = await getJobIdFromRegistry(normalizedIdentifier).catch(() => null);
  if (registryJobId && registryJobId !== normalizedIdentifier) {
    const registryJob = await getJobByDocId(user, registryJobId);
    if (registryJob) return registryJob;
  }

  const jobsRef = collection(db, rootCollections.jobs);
  for (const field of readableJobReferenceFields) {
    const lookupQuery = user.role === 'manager'
      ? query(jobsRef, where(field, '==', normalizedIdentifier), where('branchId', '==', userBranchQueryValue(user)), limit(1))
      : user.role === 'technician'
        ? query(jobsRef, where(field, '==', normalizedIdentifier), where('technicianId', '==', user.uid), limit(1))
        : query(jobsRef, where(field, '==', normalizedIdentifier), limit(1));
    const snapshot = await getDocs(lookupQuery).catch(() => null);
    if (!snapshot) continue;
    const jobDoc = snapshot.docs[0];
    if (!jobDoc) continue;

    const job = {
      docId: jobDoc.id,
      ...(jobDoc.data() as Omit<Job, 'docId'>),
    };
    if (canReadJob(user, job)) return job;
  }

  return null;
}

export { db };
