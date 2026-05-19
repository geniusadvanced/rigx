'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Job, UserData } from '@/types';
import { getJobsForUser } from '@/lib/firebase/firestore';

interface JobsState {
  jobs: Job[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useJobs(user: UserData | null): JobsState {
  const [state, setState] = useState<JobsState>({
    jobs: [],
    loading: false,
    error: null,
    refetch: async () => {},
  });

  const refetch = useCallback(async () => {
    if (!user?.role) {
      setState((current) => ({ ...current, jobs: [], loading: false, error: null }));
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      if (process.env.NODE_ENV === 'development') console.time('loadJobs');
      const jobs = await getJobsForUser(user);
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadJobs');
      setState((current) => ({ ...current, jobs, loading: false, error: null }));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.timeEnd('loadJobs');
      setState((current) => ({
        ...current,
        jobs: [],
        loading: false,
        error: error instanceof Error ? error : new Error('Unable to load jobs'),
      }));
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    if (!user?.role) {
      setState((current) => ({ ...current, jobs: [], loading: false, error: null, refetch }));
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null, refetch }));

    if (process.env.NODE_ENV === 'development') console.time('loadJobs');
    getJobsForUser(user)
      .then((jobs) => {
        if (process.env.NODE_ENV === 'development') console.timeEnd('loadJobs');
        if (!cancelled) setState((current) => ({ ...current, jobs, loading: false, error: null, refetch }));
      })
      .catch((error) => {
        if (process.env.NODE_ENV === 'development') console.timeEnd('loadJobs');
        if (!cancelled) {
          setState((current) => ({
            ...current,
            jobs: [],
            loading: false,
            error: error instanceof Error ? error : new Error('Unable to load jobs'),
            refetch,
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refetch]);

  return { ...state, refetch };
}
