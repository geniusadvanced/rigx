import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';

interface DeleteStaffUserRequest {
  staffUid?: string;
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim();
}

async function assertAdmin(request: NextRequest): Promise<string> {
  const token = getBearerToken(request);
  if (!token) throw new Error('Authentication token is required');

  const decodedToken = await adminAuth.verifyIdToken(token);
  const callerProfile = await adminDb.collection('users').doc(decodedToken.uid).get();
  if (!callerProfile.exists || callerProfile.data()?.role !== 'admin') {
    throw new Error('Admin access required');
  }

  return decodedToken.uid;
}

async function activeAdminCount(): Promise<number> {
  const snapshot = await adminDb.collection('users').where('role', '==', 'admin').get();
  return snapshot.docs.filter((row) => {
    const data = row.data();
    return data.deleted !== true && data.isActive !== false;
  }).length;
}

export async function POST(request: NextRequest) {
  try {
    const actorId = await assertAdmin(request);
    const body = (await request.json()) as DeleteStaffUserRequest;
    const staffUid = body.staffUid?.trim() || '';

    if (!staffUid) {
      return NextResponse.json({ error: 'Staff UID is required' }, { status: 400 });
    }

    if (staffUid === actorId) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
    }

    const staffRef = adminDb.collection('users').doc(staffUid);
    const staffSnapshot = await staffRef.get();
    if (!staffSnapshot.exists) {
      return NextResponse.json({ error: 'Staff profile not found' }, { status: 404 });
    }

    const staff = staffSnapshot.data() || {};
    if (staff.role === 'admin' && (await activeAdminCount()) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last active admin account' }, { status: 400 });
    }

    const authUid = String(staff.authUid || staff.uid || staffUid);
    let authDeleted = false;

    if (authUid) {
      try {
        await adminAuth.deleteUser(authUid);
        authDeleted = true;
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
        if (code !== 'auth/user-not-found') throw error;
      }
    }

    await adminDb.collection('audit_logs').add({
      actorId,
      action: 'hr.staff_deleted',
      targetCollection: 'users',
      targetId: staffUid,
      userId: actorId,
      staffUid,
      generatedAt: FieldValue.serverTimestamp(),
      metadata: {
        authUid,
        authDeleted,
        staffId: staff.staffId || '',
        email: staff.email || '',
        role: staff.role || '',
        branchId: staff.branchId || '',
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    await staffRef.delete();

    return NextResponse.json({ deleted: true, authDeleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete staff user';
    const status = message.includes('Admin access') || message.includes('Authentication token') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
