import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

let adminApp;
if (!getApps().length) {
  try {
    if (serviceAccountJson) {
      const credentials = JSON.parse(serviceAccountJson);
      adminApp = initializeApp({ credential: cert(credentials) });
    } else {
      adminApp = initializeApp({ credential: applicationDefault() });
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK. Ensure FIREBASE_SERVICE_ACCOUNT or default credentials are configured.', error);
    throw error;
  }
} else {
  adminApp = getApps()[0];
}

const adminDb = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);

export { adminDb, adminAuth, FieldValue };
