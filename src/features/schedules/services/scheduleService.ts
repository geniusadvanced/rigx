import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { writeAuditLog } from '@/features/audit/services/auditLogService';
import { db } from '@/lib/firebase/init';
import { assertCan, can } from '@/lib/rbac/can';
import type { Role } from '@/types';
import type { CreateScheduleInput, ScheduleBranch, ScheduleItem, ScheduleStatus, ScheduleTargetType } from '../types';

interface DashboardSchedulesParams {
  userId: string;
  role: Role;
  branch?: string;
}

interface ScheduleActionParams {
  scheduleId: string;
  userId: string;
  role: Role;
}

const validBranches: ScheduleBranch[] = ['all', 'bangi', 'cyberjaya'];
const validTargetTypes: ScheduleTargetType[] = ['all', 'role', 'user'];

function getDateKey(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isTodayOrTomorrow(date: string): boolean {
  return date === getDateKey(0) || date === getDateKey(1);
}

function normalizeText(value?: string): string {
  return (value || '').trim();
}

function mapSchedule(scheduleId: string, data: Record<string, unknown>): ScheduleItem {
  return {
    ...(data as Omit<ScheduleItem, 'scheduleId'>),
    scheduleId,
  };
}

function sortSchedules(schedules: ScheduleItem[]): ScheduleItem[] {
  return [...schedules].sort((left, right) => {
    const dateCompare = left.scheduleDate.localeCompare(right.scheduleDate);
    if (dateCompare !== 0) return dateCompare;
    return String(left.time || '99:99').localeCompare(String(right.time || '99:99'));
  });
}

function dedupeSchedules(schedules: ScheduleItem[]): ScheduleItem[] {
  return Array.from(new Map(schedules.map((schedule) => [schedule.scheduleId, schedule])).values());
}

function isVisibleToUser(schedule: ScheduleItem, params: DashboardSchedulesParams): boolean {
  const branch = params.branch || '';
  const branchMatches = !schedule.branch || schedule.branch === 'all' || !branch || schedule.branch === branch;

  if (!branchMatches) return false;
  if (schedule.createdBy === params.userId) return true;
  if (schedule.targetType === 'all') return true;
  if (schedule.targetType === 'role') return schedule.targetRole === params.role;
  if (schedule.targetType === 'user') return schedule.targetUserId === params.userId;
  return false;
}

async function safeWriteScheduleAudit(
  action: 'schedule_created' | 'schedule_done' | 'schedule_cancelled',
  scheduleId: string,
  actorId: string,
  actorName: string,
  before: unknown,
  after: unknown,
) {
  try {
    await writeAuditLog({
      entityType: 'schedule',
      entityId: scheduleId,
      action,
      changedBy: actorId,
      changedByDisplayName: actorName,
      changes: [{ field: 'status', before, after }],
      note: action.replaceAll('_', ' '),
    });
  } catch (error) {
    console.error('Schedule audit log failed', error);
  }
}

export async function getDashboardSchedules(params: DashboardSchedulesParams): Promise<ScheduleItem[]> {
  assertCan(params.role, 'schedules.view');

  const dates = [getDateKey(0), getDateKey(1)];
  const schedulesRef = collection(db, 'schedules');
  const baseFilters = [where('status', '==', 'active'), where('scheduleDate', 'in', dates)];

  const [allSnapshot, roleSnapshot, userSnapshot, ownSnapshot] = await Promise.all([
    getDocs(query(schedulesRef, ...baseFilters, where('targetType', '==', 'all'))),
    getDocs(query(schedulesRef, ...baseFilters, where('targetType', '==', 'role'), where('targetRole', '==', params.role))),
    getDocs(query(schedulesRef, ...baseFilters, where('targetType', '==', 'user'), where('targetUserId', '==', params.userId))),
    getDocs(query(schedulesRef, ...baseFilters, where('createdBy', '==', params.userId))),
  ]);

  const schedules = [...allSnapshot.docs, ...roleSnapshot.docs, ...userSnapshot.docs, ...ownSnapshot.docs].map((scheduleDoc) =>
    mapSchedule(scheduleDoc.id, scheduleDoc.data()),
  );

  return sortSchedules(dedupeSchedules(schedules).filter((schedule) => isVisibleToUser(schedule, params)));
}

export async function createSchedule(input: CreateScheduleInput): Promise<string> {
  assertCan(input.createdByRole, 'schedules.create');

  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const time = normalizeText(input.time);
  const branch = input.branch || 'all';

  if (!title) throw new Error('Schedule title is required');
  if (!input.createdBy) throw new Error('Schedule creator is required');
  if (!isTodayOrTomorrow(input.scheduleDate)) throw new Error('Schedule date must be today or tomorrow');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Schedule time must use HH:mm format');
  if (!validBranches.includes(branch)) throw new Error('Invalid schedule branch');
  if (!validTargetTypes.includes(input.targetType)) throw new Error('Invalid schedule target');
  if (input.targetType === 'role' && !input.targetRole) throw new Error('Target role is required');
  if (input.targetType === 'user' && !input.targetUserId) throw new Error('Target user is required');

  const scheduleRef = await addDoc(collection(db, 'schedules'), {
    title,
    description,
    scheduleDate: input.scheduleDate,
    time,
    branch,
    createdBy: input.createdBy,
    createdByName: normalizeText(input.createdByName) || 'Unknown User',
    createdByRole: input.createdByRole,
    targetType: input.targetType,
    targetRole: input.targetType === 'role' ? input.targetRole : '',
    targetUserId: input.targetType === 'user' ? input.targetUserId : '',
    status: 'active' satisfies ScheduleStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await safeWriteScheduleAudit('schedule_created', scheduleRef.id, input.createdBy, input.createdByName, null, 'active');
  return scheduleRef.id;
}

async function updateScheduleStatus(params: ScheduleActionParams, status: Extract<ScheduleStatus, 'done' | 'cancelled'>) {
  assertCan(params.role, can(params.role, 'schedules.manage') ? 'schedules.manage' : 'schedules.updateOwn');

  const scheduleRef = doc(db, 'schedules', params.scheduleId);
  const scheduleSnapshot = await getDoc(scheduleRef);

  if (!scheduleSnapshot.exists()) throw new Error('Schedule not found');

  const schedule = mapSchedule(scheduleSnapshot.id, scheduleSnapshot.data());
  const canManageAll = can(params.role, 'schedules.manage');

  if (!canManageAll && schedule.createdBy !== params.userId) {
    throw new Error('You can only update your own schedule');
  }

  await updateDoc(scheduleRef, {
    status,
    updatedAt: serverTimestamp(),
  });

  await safeWriteScheduleAudit(
    status === 'done' ? 'schedule_done' : 'schedule_cancelled',
    params.scheduleId,
    params.userId,
    'Unknown User',
    schedule.status,
    status,
  );
}

export async function markScheduleDone(params: ScheduleActionParams): Promise<void> {
  await updateScheduleStatus(params, 'done');
}

export async function cancelSchedule(params: ScheduleActionParams): Promise<void> {
  await updateScheduleStatus(params, 'cancelled');
}
