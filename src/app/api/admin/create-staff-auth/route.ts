import { NextRequest, NextResponse } from 'next/server';
import { sendInviteEmail } from '@/lib/email/sendInviteEmail';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';

interface CreateStaffAuthRequest {
  email?: string;
  name?: string;
  staffId?: string;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

function normalizeInput(body: CreateStaffAuthRequest) {
  return {
    email: body.email?.trim().toLowerCase() || '',
    name: body.name?.trim() || '',
    staffId: body.staffId?.trim() || '',
  };
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

async function getOrCreateAuthUser(email: string, name: string) {
  try {
    return await adminAuth.createUser({
      email,
      displayName: name,
      emailVerified: false,
      disabled: false,
    });
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

    if (code === 'auth/email-already-exists') {
      return adminAuth.getUserByEmail(email);
    }

    throw error;
  }
}

async function writeInviteAudit(
  actorId: string,
  staffUid: string,
  action: 'hr.invite_sent' | 'hr.invite_failed',
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
    const input = normalizeInput((await request.json()) as CreateStaffAuthRequest);

    if (!input.email || !input.name || !input.staffId) {
      return NextResponse.json({ error: 'Email, name, and staff ID are required' }, { status: 400 });
    }

    const staffSnapshot = await adminDb
      .collection('users')
      .where('staffId', '==', input.staffId)
      .limit(1)
      .get();

    if (staffSnapshot.empty) {
      return NextResponse.json({ error: 'Staff profile not found' }, { status: 404 });
    }

    const sourceProfileDoc = staffSnapshot.docs[0];
    const sourceProfile = sourceProfileDoc.data();

    if (sourceProfile.authUid || sourceProfile.hasLogin) {
      return NextResponse.json({ error: 'Staff profile already has a login account' }, { status: 409 });
    }

    if (sourceProfile.email && String(sourceProfile.email).toLowerCase() !== input.email) {
      return NextResponse.json({ error: 'Email does not match the staff profile email' }, { status: 400 });
    }

    const authUser = await getOrCreateAuthUser(input.email, input.name);
    const resetPasswordLink = await adminAuth.generatePasswordResetLink(input.email);
    const targetProfileRef = adminDb.collection('users').doc(authUser.uid);

    await adminDb.runTransaction(async (transaction) => {
      const latestSourceProfile = await transaction.get(sourceProfileDoc.ref);
      const latestTargetProfile = await transaction.get(targetProfileRef);

      if (!latestSourceProfile.exists) {
        throw new Error('Staff profile not found');
      }

      const latestSourceData = latestSourceProfile.data() || {};
      if (latestSourceData.authUid || latestSourceData.hasLogin) {
        throw new Error('Staff profile already has a login account');
      }

      const linkedProfile = {
        ...latestSourceData,
        uid: authUser.uid,
        authUid: authUser.uid,
        hasLogin: true,
        inviteEmailSent: false,
        inviteEmailStatus: 'pending',
        email: input.email,
        name: latestSourceData.name || input.name,
        displayName: latestSourceData.displayName || latestSourceData.name || input.name,
        updatedAt: FieldValue.serverTimestamp(),
      };

      transaction.set(targetProfileRef, linkedProfile, { merge: true });

      if (sourceProfileDoc.id !== authUser.uid) {
        transaction.delete(sourceProfileDoc.ref);
      }

      transaction.set(adminDb.collection('audit_logs').doc(), {
        actorId,
        action: 'hr.staff_auth_created',
        targetCollection: 'users',
        targetId: authUser.uid,
        userId: actorId,
        staffUid: authUser.uid,
        generatedAt: FieldValue.serverTimestamp(),
        metadata: {
          previousProfileId: sourceProfileDoc.id,
          authUid: authUser.uid,
          staffId: input.staffId,
          email: input.email,
          migratedProfile: sourceProfileDoc.id !== authUser.uid,
        },
        createdAt: FieldValue.serverTimestamp(),
      });

      if (latestTargetProfile.exists && sourceProfileDoc.id !== authUser.uid) {
        transaction.update(targetProfileRef, {
          uid: authUser.uid,
          authUid: authUser.uid,
          hasLogin: true,
          inviteEmailSent: false,
          inviteEmailStatus: 'pending',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    let inviteEmailSent = false;
    let inviteEmailError: string | undefined;

    try {
      await sendInviteEmail({
        to: input.email,
        name: input.name,
        resetPasswordLink,
      });
      inviteEmailSent = true;
      await adminDb.collection('users').doc(authUser.uid).update({
        inviteEmailSent: true,
        inviteEmailStatus: 'sent',
        inviteEmailSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeInviteAudit(actorId, authUser.uid, 'hr.invite_sent', {
        staffId: input.staffId,
        email: input.email,
      });
    } catch (emailError) {
      inviteEmailError = emailError instanceof Error ? emailError.message : 'Invite email failed';
      console.error('Staff invite email delivery failed', {
        staffId: input.staffId,
        email: input.email,
        error: inviteEmailError,
      });
      await adminDb.collection('users').doc(authUser.uid).update({
        inviteEmailSent: false,
        inviteEmailStatus: 'failed',
        inviteEmailFailedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeInviteAudit(actorId, authUser.uid, 'hr.invite_failed', {
        staffId: input.staffId,
        email: input.email,
        error: inviteEmailError,
      });
    }

    return NextResponse.json({
      uid: authUser.uid,
      resetPasswordLink,
      inviteEmailSent,
      inviteEmailStatus: inviteEmailSent ? 'sent' : 'failed',
      inviteEmailError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create staff login account';
    const status = message.includes('Admin access') || message.includes('Authentication token') ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
