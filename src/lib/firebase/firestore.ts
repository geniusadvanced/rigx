import {
  collection,
  doc,
  getDoc,
  getDocs,
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

export { db };
