import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value.replace(/\\n/g, '\n');
  }
}

loadEnvFile('.env.local');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });

const db = getFirestore(app);
const write = process.argv.includes('--write');

function yearParts(date = new Date()) {
  const year = date.getFullYear();
  return { year, shortYear: String(year).slice(-2) };
}

function publicNumber(prefix, year, runningNumber) {
  return `${prefix}-${String(year).slice(-2)}${String(runningNumber).padStart(4, '0')}`;
}

function validCustomerNumber(value) {
  return /^RIGX-\d{6}$/.test(String(value || ''));
}

function validQuotationNumber(value) {
  return /^QT-\d{6}$/.test(String(value || ''));
}

async function reserveCounterNumber(counterPrefix, documentPrefix) {
  const { year } = yearParts();
  const counterRef = db.collection('counters').doc(`${counterPrefix}_${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const lastNumber = snapshot.exists && typeof snapshot.data().lastNumber === 'number'
      ? snapshot.data().lastNumber
      : 0;
    const nextNumber = lastNumber + 1;
    const number = publicNumber(documentPrefix, year, nextNumber);
    transaction.set(counterRef, {
      year,
      prefix: documentPrefix,
      lastNumber: nextNumber,
      lastPublicNumber: number,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { number, year, runningNumber: nextNumber };
  });
}

async function reserveJobNumber(jobId) {
  const { year } = yearParts();
  const counterRef = db.collection('systemCounters').doc(`jobNumbers_${year}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const lastNumber = snapshot.exists && typeof snapshot.data().lastNumber === 'number'
      ? snapshot.data().lastNumber
      : 0;
    const nextNumber = lastNumber + 1;
    const number = publicNumber('RIGX', year, nextNumber);
    const registryRef = db.collection('jobNumberRegistry').doc(number);
    const registrySnapshot = await transaction.get(registryRef);
    if (registrySnapshot.exists) throw new Error(`Generated duplicate job number ${number}`);
    transaction.set(counterRef, {
      year,
      prefix: 'RIGX',
      lastNumber: nextNumber,
      lastJobNo: number,
      lastJobId: jobId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(registryRef, {
      jobId,
      jobNo: number,
      year,
      runningNumber: nextNumber,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { number, year, runningNumber: nextNumber };
  });
}

async function backfillCollection(collectionName, isValid, reserve, updateData) {
  const snapshot = await db.collection(collectionName).get();
  let updated = 0;
  let skipped = 0;

  for (const document of snapshot.docs) {
    const data = document.data();
    if (isValid(data)) {
      skipped += 1;
      continue;
    }
    const reserved = await reserve(document.id);
    updated += 1;
    console.log(`${write ? 'Updating' : 'Would update'} ${collectionName}/${document.id} -> ${reserved.number}`);
    if (write) {
      await document.ref.update({
        ...updateData(reserved),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`${collectionName}: ${updated} ${write ? 'updated' : 'pending'}, ${skipped} skipped`);
}

await backfillCollection(
  'customers',
  (data) => validCustomerNumber(data.customerNumber),
  () => reserveCounterNumber('customerNumber', 'RIGX'),
  ({ number }) => ({ customerNumber: number }),
);

await backfillCollection(
  'jobs',
  (data) => validCustomerNumber(data.jobNo) && data.jobNumber === data.jobNo && data.jobSheetNo === data.jobNo,
  (jobId) => reserveJobNumber(jobId),
  ({ number, year, runningNumber }) => ({
    jobNo: number,
    jobNumber: number,
    jobSheetNo: number,
    jobNumberYear: year,
    jobNumberRunningNumber: runningNumber,
  }),
);

await backfillCollection(
  'quotations',
  (data) => validQuotationNumber(data.quotationNumber) || validQuotationNumber(data.quotationNo),
  () => reserveCounterNumber('quotationNumber', 'QT'),
  ({ number }) => ({ quotationNumber: number, quotationNo: number }),
);

console.log(write ? 'Backfill complete.' : 'Dry run complete. Re-run with --write to apply changes.');
