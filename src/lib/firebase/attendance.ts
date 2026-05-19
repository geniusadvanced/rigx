import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';
import { assertCan } from '@/lib/rbac/can';
import { getAttendanceDateKey } from '@/lib/utils/attendanceDate';
import { calculateDistanceInMeters, isWithinGeofence } from '@/lib/utils/geolocation';
import type { UserData } from '@/types';

interface ClockInSuccess {
  success: true;
  attendanceId: string;
  status: 'present' | 'late';
  clockInTime: Date;
  branchId: string;
  clockInBranchId: string;
  clockInDistance: number;
}

interface ClockInFailure {
  success: false;
  error: string;
}

type ClockInResult = ClockInSuccess | ClockInFailure;

interface ClockOutSuccess {
  success: true;
  attendanceId: string;
  status: 'present' | 'half_day';
  attendanceType: 'full' | 'half';
  totalHours: number;
  clockOutTime: Date;
  clockInBranchId: string;
  clockOutBranchId: string;
  branchId: string;
  crossBranchAttendance: boolean;
}

interface ClockOutFailure {
  success: false;
  error: string;
}

type ClockOutResult = ClockOutSuccess | ClockOutFailure;

interface BrowserLocation {
  latitude: number;
  longitude: number;
}

interface BranchGeofence {
  branchId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusInMeters: number;
}

interface BranchDetectionResult {
  detectedBranch: (BranchGeofence & { distance: number }) | null;
  nearestBranch: (BranchGeofence & { distance: number; isWithinRadius: boolean }) | null;
}

const defaultAttendanceRadiusMeters = 500;

const knownGeniusBranches: Record<string, BranchGeofence> = {
  cyberjaya: {
    branchId: 'cyberjaya',
    name: 'Genius Advanced Cyberjaya',
    address: 'GF-04 Menara Paragon Pangaea, Persiaran Bestari, Cyber 11, 63000 Cyberjaya, Selangor.',
    latitude: 2.921989,
    longitude: 101.653872,
    radiusInMeters: defaultAttendanceRadiusMeters,
  },
  bangi: {
    branchId: 'bangi',
    name: 'Genius Advanced Bangi',
    address: '11-1-1B, Jalan Medan Pb2a, Seksyen 9, Bandar Baru Bangi, 43650 Bangi, Selangor.',
    latitude: 2.962185,
    longitude: 101.756249,
    radiusInMeters: defaultAttendanceRadiusMeters,
  },
};

function getKnownBranchKey(branchId: string, branch: Record<string, unknown>): 'cyberjaya' | 'bangi' | null {
  const searchable = [
    branchId,
    branch.branchId,
    branch.name,
    branch.displayName,
    branch.address,
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  if (searchable.includes('cyberjaya')) return 'cyberjaya';
  if (searchable.includes('bangi')) return 'bangi';
  return null;
}

function getNumericBranchField(branch: Record<string, unknown>, field: 'latitude' | 'longitude'): number {
  const location = branch.location as { latitude?: unknown; longitude?: unknown } | undefined;
  return Number(location?.[field] ?? branch[field]);
}

function getBranchRadius(branch: Record<string, unknown>): number {
  const radius = Number(branch.radiusMeters ?? branch.radiusInMeters);
  return Number.isFinite(radius) && radius > 0 ? radius : defaultAttendanceRadiusMeters;
}

function getBranchName(branchId: string, branch: Record<string, unknown>, knownBranchKey: 'cyberjaya' | 'bangi' | null): string {
  if (knownBranchKey) return knownGeniusBranches[knownBranchKey].name;
  return String(branch.name || branch.displayName || branchId);
}

function getBranchAddress(branch: Record<string, unknown>, knownBranchKey: 'cyberjaya' | 'bangi' | null): string {
  if (knownBranchKey) return knownGeniusBranches[knownBranchKey].address;
  return String(branch.address || '');
}

function getKualaLumpurMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);

  return hour * 60 + minute;
}

function getClockInStatus(clockInTime: Date): 'present' | 'late' {
  const gracePeriodMinutes = 10 * 60 + 15;
  return getKualaLumpurMinutes(clockInTime) > gracePeriodMinutes ? 'late' : 'present';
}

function getGeolocationErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = Number((error as { code?: number }).code);

    if (code === 1) return 'Location permission denied. Please allow location access to clock in or out.';
    if (code === 2) return 'Location unavailable. Please check device location settings and try again.';
    if (code === 3) return 'Location request timed out. Please try again.';
  }

  return error instanceof Error ? error.message : 'Unable to get current location';
}

function getBrowserLocation(): Promise<BrowserLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => reject(new Error(getGeolocationErrorMessage(error))),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
}

async function getDetectedBranch(location: BrowserLocation): Promise<BranchDetectionResult> {
  const branchesSnapshot = await getDocs(collection(db, 'branches'));
  const branchMap = new Map<string, BranchGeofence>(
    Object.entries(knownGeniusBranches).map(([branchId, branch]) => [branchId, branch]),
  );
  let detectedBranch: (BranchGeofence & { distance: number }) | null = null;
  let nearestBranch: (BranchGeofence & { distance: number; isWithinRadius: boolean }) | null = null;

  console.log('Attendance geofence user location:', {
    latitude: location.latitude,
    longitude: location.longitude,
  });

  for (const branchDoc of branchesSnapshot.docs) {
    const branch = branchDoc.data();
    const knownBranchKey = getKnownBranchKey(branchDoc.id, branch);
    const branchId = knownBranchKey || branchDoc.id;
    const isActive = branch.isActive !== false && branch.active !== false;

    if (!isActive) {
      console.log('Skipping inactive branch geofence', { branchId: branchDoc.id });
      branchMap.delete(branchId);
      continue;
    }

    const rawLatitude = getNumericBranchField(branch, 'latitude');
    const rawLongitude = getNumericBranchField(branch, 'longitude');
    const defaultBranch = knownBranchKey ? knownGeniusBranches[knownBranchKey] : null;
    const latitude = defaultBranch?.latitude ?? rawLatitude;
    const longitude = defaultBranch?.longitude ?? rawLongitude;
    const radiusInMeters = getBranchRadius(branch);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn('Invalid branch geofence: latitude/longitude must be numbers', {
        branchId: branchDoc.id,
        latitude: getNumericBranchField(branch, 'latitude'),
        longitude: getNumericBranchField(branch, 'longitude'),
      });
      continue;
    }

    if (!Number.isFinite(radiusInMeters)) {
      console.warn('Invalid branch geofence: radiusInMeters must be a number', {
        branchId: branchDoc.id,
        radiusInMeters: branch.radiusMeters ?? branch.radiusInMeters,
      });
      continue;
    }

    branchMap.set(branchId, {
      branchId,
      name: getBranchName(branchDoc.id, branch, knownBranchKey),
      address: getBranchAddress(branch, knownBranchKey),
      latitude,
      longitude,
      radiusInMeters,
    });
  }

  console.log('Attendance active branch geofences:', Array.from(branchMap.values()).map((branch) => ({
    branchId: branch.branchId,
    name: branch.name,
    latitude: branch.latitude,
    longitude: branch.longitude,
    radiusInMeters: branch.radiusInMeters,
  })));

  for (const branch of branchMap.values()) {
    const latitude = branch.latitude;
    const longitude = branch.longitude;
    const radiusInMeters = branch.radiusInMeters;

    const distance = calculateDistanceInMeters(
      { latitude: location.latitude, longitude: location.longitude },
      { latitude, longitude },
    );

    const isInside = isWithinGeofence(
      location.latitude,
      location.longitude,
      latitude,
      longitude,
      radiusInMeters,
    );

    if (!nearestBranch || distance < nearestBranch.distance) {
      nearestBranch = {
        ...branch,
        latitude,
        longitude,
        radiusInMeters,
        distance,
        isWithinRadius: isInside,
      };
    }

    console.log('Branch geofence debug:', {
      branchId: branch.branchId,
      branchName: branch.name,
      branchLatitude: latitude,
      branchLongitude: longitude,
      radiusInMeters,
      distance,
      isWithinRadius: isInside,
      isAutoDetected: true,
    });

    if (!isInside) continue;

    if (!detectedBranch || distance < detectedBranch.distance) {
      detectedBranch = {
        ...branch,
        latitude,
        longitude,
        radiusInMeters,
        distance,
      };
    }
  }

  if (detectedBranch) {
    console.log('Detected branch:', {
      distance: detectedBranch.distance,
      branchId: detectedBranch.branchId,
      isAutoDetected: true,
    });
  } else if (nearestBranch) {
    console.log('Nearest branch outside radius:', {
      distance: nearestBranch.distance,
      branchId: nearestBranch.branchId,
      radiusInMeters: nearestBranch.radiusInMeters,
      isWithinRadius: false,
      isAutoDetected: true,
    });
  }

  return { detectedBranch, nearestBranch };
}

function buildNoBranchAreaError(
  nearestBranch: BranchDetectionResult['nearestBranch'],
  location: BrowserLocation,
): string {
  const detectedLocation = `Detected location: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;

  if (!nearestBranch) {
    return `You are not within any branch area. ${detectedLocation}. No active branch geofence is available.`;
  }

  return `You are not within any branch area. ${detectedLocation}. Nearest branch: ${nearestBranch.name} (${nearestBranch.branchId}), Distance: ${Math.round(
    nearestBranch.distance,
  )}m, Allowed radius: ${Math.round(nearestBranch.radiusInMeters)}m`;
}

function getTimestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  return null;
}

export async function clockIn(userData: UserData): Promise<ClockInResult> {
  try {
    assertCan(userData.role, 'attendance.clock');

    if (!userData.uid) {
      return {
        success: false,
        error: 'User profile UID is missing',
      };
    }

    if (!userData.branchId) {
      return {
        success: false,
        error: 'User profile branch is missing',
      };
    }

    const date = getAttendanceDateKey();
    const attendanceId = `${userData.uid}_${date}`;
    console.log('clockIn attendance write path:', `attendance/${attendanceId}`);
    const attendanceRef = doc(db, 'attendance', attendanceId);
    const attendanceSnapshot = await getDoc(attendanceRef);

    if (attendanceSnapshot.exists() && attendanceSnapshot.data().clockIn?.timestamp) {
      return {
        success: false,
        error: 'Already clocked in today',
      };
    }

    const location = await getBrowserLocation();
    const { detectedBranch, nearestBranch } = await getDetectedBranch(location);

    if (!detectedBranch) {
      return {
        success: false,
        error: buildNoBranchAreaError(nearestBranch, location),
      };
    }

    const clockInTimestamp = Timestamp.now();
    const clockInTime = clockInTimestamp.toDate();
    const status = getClockInStatus(clockInTime);

    await setDoc(
      attendanceRef,
      {
        userId: userData.uid,
        branchId: detectedBranch.branchId,
        clockInBranchId: detectedBranch.branchId,
        clockInDistance: detectedBranch.distance,
        isAutoDetected: true,
        crossBranchAttendance: false,
        transferDetected: false,
        date,
        clockIn: {
          timestamp: clockInTimestamp,
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          isOutside: false,
          isAutoDetected: true,
          distance: detectedBranch.distance,
        },
        status,
        createdAt: attendanceSnapshot.exists() ? attendanceSnapshot.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return {
      success: true,
      attendanceId,
      status,
      clockInTime,
      branchId: detectedBranch.branchId,
      clockInBranchId: detectedBranch.branchId,
      clockInDistance: detectedBranch.distance,
    };
  } catch (error) {
    console.error('clockIn failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to clock in',
    };
  }
}

export async function clockOut(userData: UserData): Promise<ClockOutResult> {
  try {
    assertCan(userData.role, 'attendance.clock');

    if (!userData.uid) {
      return {
        success: false,
        error: 'User profile UID is missing',
      };
    }

    if (!userData.branchId) {
      return {
        success: false,
        error: 'User profile branch is missing',
      };
    }

    const date = getAttendanceDateKey();
    const attendanceId = `${userData.uid}_${date}`;
    console.log('clockOut attendance write path:', `attendance/${attendanceId}`);
    const attendanceRef = doc(db, 'attendance', attendanceId);
    const attendanceSnapshot = await getDoc(attendanceRef);

    if (!attendanceSnapshot.exists() || !attendanceSnapshot.data().clockIn?.timestamp) {
      return {
        success: false,
        error: 'You must clock in before clocking out',
      };
    }

    const attendance = attendanceSnapshot.data();

    if (attendance.clockOut?.timestamp) {
      return {
        success: false,
        error: 'You have already clocked out today',
      };
    }

    const location = await getBrowserLocation();
    const { detectedBranch, nearestBranch } = await getDetectedBranch(location);

    if (!detectedBranch) {
      return {
        success: false,
        error: buildNoBranchAreaError(nearestBranch, location),
      };
    }

    const clockInMillis = getTimestampMillis(attendance.clockIn.timestamp);

    if (!clockInMillis) {
      return {
        success: false,
        error: 'Clock-in timestamp is unavailable',
      };
    }

    const clockOutTimestamp = Timestamp.now();
    const totalHours = Number(((clockOutTimestamp.toMillis() - clockInMillis) / (1000 * 60 * 60)).toFixed(2));
    const attendanceType: 'full' | 'half' = totalHours < 5 ? 'half' : 'full';
    const status: 'present' | 'half_day' = attendanceType === 'half' ? 'half_day' : 'present';
    const clockInBranchId = String(attendance.clockInBranchId || attendance.branchId || attendance.clockIn?.branchId || '');
    const crossBranchAttendance = Boolean(clockInBranchId && clockInBranchId !== detectedBranch.branchId);

    await updateDoc(attendanceRef, {
      clockInBranchId,
      clockOutBranchId: detectedBranch.branchId,
      clockOutDistance: detectedBranch.distance,
      isAutoDetected: true,
      crossBranchAttendance,
      transferDetected: crossBranchAttendance,
      totalHours,
      attendanceType,
      clockOut: {
        timestamp: clockOutTimestamp,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
        isOutside: false,
        isAutoDetected: true,
        branchId: detectedBranch.branchId,
        distance: detectedBranch.distance,
      },
      status,
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
      attendanceId,
      status,
      attendanceType,
      totalHours,
      clockOutTime: clockOutTimestamp.toDate(),
      clockInBranchId,
      clockOutBranchId: detectedBranch.branchId,
      branchId: String(attendance.branchId || clockInBranchId),
      crossBranchAttendance,
    };
  } catch (error) {
    console.error('clockOut failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to clock out',
    };
  }
}
