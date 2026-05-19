'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingState } from '@/components/shared/LoadingState';
import { useUser } from '@/lib/hooks/useUser';

export default function HomePage() {
  const router = useRouter();
  const { firebaseUser, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    router.replace(firebaseUser ? '/dashboard' : '/login');
  }, [firebaseUser, loading, router]);

  return <LoadingState label="Opening RIGX Genius" />;
}

