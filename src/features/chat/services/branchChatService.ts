import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import type { UserData } from '@/types';
import type { BranchChatBranch, BranchChatMessage, BranchChatRead } from '../types';

export function normalizeBranch(value?: string): BranchChatBranch | null {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('cyberjaya')) return 'cyberjaya';
  if (normalized.includes('bangi')) return 'bangi';
  return null;
}

export function getBranchLabel(value?: string | null): string {
  if (value === 'cyberjaya') return 'Cyberjaya';
  if (value === 'bangi') return 'Bangi';
  return 'Unknown Branch';
}

function mapBranchChatMessage(messageId: string, data: Record<string, unknown>): BranchChatMessage {
  return {
    ...(data as Omit<BranchChatMessage, 'messageId'>),
    messageId,
  };
}

export function subscribeToBranchChat(onMessages: (messages: BranchChatMessage[]) => void, onError: (error: Error) => void) {
  const chatQuery = query(collection(db, 'branchChats'), orderBy('createdAt', 'desc'), limit(50));

  return onSnapshot(
    chatQuery,
    (snapshot) => {
      const messages = snapshot.docs
        .map((messageDoc) => mapBranchChatMessage(messageDoc.id, messageDoc.data()))
        .reverse();
      onMessages(messages);
    },
    (error) => {
      onError(error);
    },
  );
}

export function subscribeToBranchChatRead(
  userId: string,
  onRead: (read: BranchChatRead | null) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, 'branchChatReads', userId),
    (snapshot) => {
      onRead(snapshot.exists() ? (snapshot.data() as BranchChatRead) : null);
    },
    (error) => {
      onError(error);
    },
  );
}

export async function markBranchChatRead(userId: string): Promise<void> {
  await setDoc(
    doc(db, 'branchChatReads', userId),
    {
      userId,
      lastReadAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function getBranchChatRead(userId: string): Promise<BranchChatRead | null> {
  const snapshot = await getDoc(doc(db, 'branchChatReads', userId));
  return snapshot.exists() ? (snapshot.data() as BranchChatRead) : null;
}

export async function sendBranchChatMessage(user: UserData, message: string): Promise<void> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error('Message cannot be empty');

  const senderBranch = normalizeBranch(user.branchId);
  if (!senderBranch) {
    throw new Error('Your branch must be Cyberjaya or Bangi to send branch chat messages');
  }

  await addDoc(collection(db, 'branchChats'), {
    message: trimmedMessage,
    senderId: user.uid,
    senderDisplayName: user.displayName || user.name || 'Unknown User',
    senderRole: user.role,
    senderBranch,
    createdAt: serverTimestamp(),
  });
}
