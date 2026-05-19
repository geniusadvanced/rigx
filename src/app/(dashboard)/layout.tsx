'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { LoadingState } from '@/components/shared/LoadingState';
import { useUser } from '@/lib/hooks/useUser';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { firebaseUser, profile, loading } = useUser();

  useEffect(() => {
    if (!loading && !firebaseUser) router.replace('/login');
  }, [firebaseUser, loading, router]);

  if (loading) return <LoadingState label="Loading dashboard" />;
  if (!firebaseUser) return <LoadingState label="Redirecting to login" />;
  if (!profile?.role) return <LoadingState label="Loading profile" />;

  return <DashboardShell user={profile}>{children}</DashboardShell>;
}
