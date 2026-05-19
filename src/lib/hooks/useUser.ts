'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { UserData } from '@/types';
import { getUserData } from '@/lib/firebase/firestore';
import { observeAuthState } from '@/lib/firebase/auth';

interface UserState {
  firebaseUser: User | null;
  profile: UserData | null;
  loading: boolean;
  error: Error | null;
}

let cachedFirebaseUser: User | null = null;
let cachedProfile: UserData | null = null;

export function useUser(): UserState {
  const [state, setState] = useState<UserState>({
    firebaseUser: cachedFirebaseUser,
    profile: cachedProfile,
    loading: !cachedFirebaseUser || !cachedProfile?.role,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = observeAuthState(async (firebaseUser) => {
      if (!firebaseUser) {
        cachedFirebaseUser = null;
        cachedProfile = null;
        if (!cancelled) {
          setState({ firebaseUser: null, profile: null, loading: false, error: null });
        }
        return;
      }

      try {
        if (cachedFirebaseUser?.uid === firebaseUser.uid && cachedProfile?.role) {
          if (!cancelled) {
            setState({ firebaseUser, profile: cachedProfile, loading: false, error: null });
          }
          return;
        }

        if (process.env.NODE_ENV === 'development') console.time('loadUserProfile');
        const profile = await getUserData(firebaseUser.uid);
        if (process.env.NODE_ENV === 'development') console.timeEnd('loadUserProfile');
        cachedFirebaseUser = firebaseUser;
        cachedProfile = profile;
        if (!cancelled) {
          setState({ firebaseUser, profile, loading: false, error: null });
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') console.timeEnd('loadUserProfile');
        if (!cancelled) {
          setState({
            firebaseUser,
            profile: null,
            loading: false,
            error: error instanceof Error ? error : new Error('Unable to load user profile'),
          });
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
