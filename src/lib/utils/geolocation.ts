import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/init';

interface BranchLocation {
  latitude: number;
  longitude: number;
  radiusInMeters: number;
}

interface ClockInLocationResult {
  isAllowed: boolean;
  distance: number;
  isOutside: boolean;
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function calculateDistanceInMeters(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  const earthRadiusInMeters = 6371000;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);

  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusInMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isWithinGeofence(
  userLatitude: number,
  userLongitude: number,
  branchLatitude: number,
  branchLongitude: number,
  radiusInMeters: number,
): boolean {
  const distance = calculateDistanceInMeters(
    { latitude: userLatitude, longitude: userLongitude },
    { latitude: branchLatitude, longitude: branchLongitude },
  );

  console.log('Geofence distance:', distance);
  console.log('Geofence radius:', radiusInMeters);

  return distance <= radiusInMeters;
}

async function getBranchLocation(branchId: string): Promise<BranchLocation> {
  const snapshot = await getDoc(doc(db, 'branches', branchId));

  if (!snapshot.exists()) {
    throw new Error('Branch location not found');
  }

  const data = snapshot.data();
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  const radiusInMeters = Number(data.radiusInMeters);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusInMeters)) {
    throw new Error('Branch location is incomplete');
  }

  return { latitude, longitude, radiusInMeters };
}

export async function checkClockInLocation(branchId: string): Promise<ClockInLocationResult> {
  const [position, branchLocation] = await Promise.all([
    getCurrentPosition(),
    getBranchLocation(branchId),
  ]);

  const distance = calculateDistanceInMeters(
    {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    },
    branchLocation,
  );

  const isAllowed = distance <= branchLocation.radiusInMeters;

  return {
    isAllowed,
    distance,
    isOutside: !isAllowed,
  };
}
