import type { Timestamp } from 'firebase/firestore';
import type { Role } from '@/types';

export type BranchChatBranch = 'cyberjaya' | 'bangi';

export interface BranchChatMessage {
  messageId: string;
  message: string;
  senderId: string;
  senderDisplayName: string;
  senderRole: Role;
  senderBranch: BranchChatBranch;
  createdAt: Timestamp;
}

export interface BranchChatRead {
  userId: string;
  lastReadAt: Timestamp;
}
