import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';

type PublicNumberKind = 'customer' | 'quotation';

const CONFIG: Record<PublicNumberKind, { counterPrefix: string; documentPrefix: string }> = {
  customer: { counterPrefix: 'customerNumber', documentPrefix: 'RIGX' },
  quotation: { counterPrefix: 'quotationNumber', documentPrefix: 'QT' },
};

function currentYearParts(date = new Date()) {
  const year = date.getFullYear();
  return { year, shortYear: String(year).slice(-2) };
}

export function formatPublicNumber(prefix: string, year: number, runningNumber: number): string {
  return `${prefix}-${String(year).slice(-2)}${String(runningNumber).padStart(4, '0')}`;
}

export function isRigxPublicNumber(value?: string | null): boolean {
  return /^RIGX-\d{6}$/.test(String(value || '').trim());
}

export function isQuotationPublicNumber(value?: string | null): boolean {
  return /^QT-\d{6}$/.test(String(value || '').trim());
}

async function generatePublicNumber(kind: PublicNumberKind): Promise<string> {
  const config = CONFIG[kind];
  const { year } = currentYearParts();
  const counterRef = doc(db, 'counters', `${config.counterPrefix}_${year}`);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const lastNumber = snapshot.exists() && typeof snapshot.data().lastNumber === 'number'
      ? snapshot.data().lastNumber
      : 0;
    const nextNumber = lastNumber + 1;
    const publicNumber = formatPublicNumber(config.documentPrefix, year, nextNumber);

    transaction.set(counterRef, {
      year,
      prefix: config.documentPrefix,
      lastNumber: nextNumber,
      lastPublicNumber: publicNumber,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return publicNumber;
  });
}

export function generateCustomerNumber(): Promise<string> {
  return generatePublicNumber('customer');
}

export function generateQuotationNumber(): Promise<string> {
  return generatePublicNumber('quotation');
}
