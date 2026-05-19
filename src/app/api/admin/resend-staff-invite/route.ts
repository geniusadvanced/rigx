import { NextRequest, NextResponse } from 'next/server';
import { sendInviteEmail } from '@/lib/email/sendInviteEmail';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';

interface ResendStaffInviteRequest {
  staffUid?: string;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

async function assertAdmin(request: NextRequest): Promise<string> {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error('Authentication token is required');
  }

  const decodedToken = await adminAuth.verifyIdToken(token);
  const callerProfile = await adminDb.collection('users').doc(decodedToken.uid).get();

  if (!callerProfile.exists || callerProfile.data()?.role !== 'admin') {
    throw new Error('Admin access required');
  }

  return decodedToken.uid;
}

async function writeInviteAudit(
  actorId: string,
  staffUid: string,
  action: 'hr.invite_resent' | 'hr.invite_failed',
  metadata: Record<string, unknown>,
) {
  await adminDb.collection('audit_logs').add({
    actorId,
    action,
    targetCollection: 'users',
    targetId: staffUid,
    userId: actorId,
    staffUid,
    generatedAt: FieldValue.serverTimestamp(),
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const actorId = await assertAdmin(request);
    const body = (await request.json()) as ResendStaffInviteRequest;
    const staffUid = body.staffUid?.trim() || '';

    if (!staffUid) {
      return NextResponse.json({ error: 'Staff UID is required' }, { status: 400 });
    }

    const staffRef = adminDb.collection('users').doc(staffUid);
    const staffSnapshot = await staffRef.get();

    if (!staffSnapshot.exists) {
      return NextResponse.json({ error: 'Staff profile not found' }, { status: 404 });
    }

    const staff = staffSnapshot.data() || {};
    const authUid = String(staff.authUid || staff.uid || staffUid);
    const email = String(staff.email || '').trim().toLowerCase();
    const name = String(staff.name || staff.displayName || staff.staffId || 'Staff');

    if (!staff.hasLogin || !staff.authUid) {
      return NextResponse.json({ error: 'Staff profile does not have a linked login account' }, { status: 400 });
    }

    if (authUid !== staffUid) {
      return NextResponse.json({ error: 'Staff profile UID is not linked correctly' }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ error: 'Staff email is required' }, { status: 400 });
    }

    await adminAuth.getUser(authUid);
    const resetPasswordLink = await adminAuth.generatePasswordResetLink(email);

    try {
      await staffRef.update({
        inviteEmailSent: false,
        inviteEmailStatus: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await sendInviteEmail({
        to: email,
        name,
        resetPasswordLink,
      });
      await staffRef.update({
        inviteEmailSent: true,
        inviteEmailStatus: 'sent',
        inviteEmailSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeInviteAudit(actorId, staffUid, 'hr.invite_resent', {
        staffId: staff.staffId || '',
        email,
      });

      return NextResponse.json({
        resetPasswordLink,
        inviteEmailSent: true,
        inviteEmailStatus: 'sent',
      });
    } catch (emailError) {
      const inviteEmailError = emailError instanceof Error ? emailError.message : 'Invite email failed';
      console.error('Staff invite resend failed', {
        staffUid,
        email,
        error: inviteEmailError,
      });
      await staffRef.update({
        inviteEmailSent: false,
        inviteEmailStatus: 'failed',
        inviteEmailFailedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeInviteAudit(actorId, staffUid, 'hr.invite_failed', {
        staffId: staff.staffId || '',
        email,
        error: inviteEmailError,
        resend: true,
      });

      return NextResponse.json({
        resetPasswordLink,
        inviteEmailSent: false,
        inviteEmailStatus: 'failed',
        inviteEmailError,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resend staff invite';
    const status = message.includes('Admin access') || message.includes('Authentication token') ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
