import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

function firebaseAdminCredential() {
  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is required for Firebase Admin. Configure it in Vercel environment variables.');
  }

  try {
    return cert(JSON.parse(serviceAccountJson));
  } catch (error) {
    throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const adminApp = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: firebaseAdminCredential(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminBucket = getStorage(adminApp).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
export { FieldValue };
