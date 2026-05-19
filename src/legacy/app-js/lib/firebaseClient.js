// src/app/lib/firebaseClient.js

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const requiredKeys = [
  { prop: "apiKey", env: "NEXT_PUBLIC_FIREBASE_API_KEY" },
  { prop: "authDomain", env: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" },
  { prop: "projectId", env: "NEXT_PUBLIC_FIREBASE_PROJECT_ID" },
  { prop: "storageBucket", env: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" },
  { prop: "messagingSenderId", env: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" },
  { prop: "appId", env: "NEXT_PUBLIC_FIREBASE_APP_ID" },
];

const missingEnv = requiredKeys.filter(({ prop }) => !firebaseConfig[prop]);
if (missingEnv.length && process.env.NODE_ENV !== "production") {
  const envList = missingEnv.map(({ env }) => env).join(", ");
  throw new Error(
    `Missing Firebase environment variables: ${envList}. ` +
    "Add them to .env.local (NEXT_PUBLIC_*) and restart the dev server."
  );
}

// Prevent duplicate initialization
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Analytics only in browser
let analytics = null;
if (typeof window !== "undefined") {
  isSupported().then((ok) => {
    if (ok) analytics = getAnalytics(app);
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export { app, analytics };

// Firebase env checklist (set via .env.local and restart next dev server):
// NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID,
// NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, NEXT_PUBLIC_FIREBASE_APP_ID,
