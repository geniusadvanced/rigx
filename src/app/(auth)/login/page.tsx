'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithEmail } from '@/lib/firebase/auth';
import { useUser } from '@/lib/hooks/useUser';

export default function LoginPage() {
  const router = useRouter();
  const { firebaseUser, loading } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && firebaseUser) router.replace('/dashboard');
  }, [firebaseUser, loading, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await loginWithEmail(email, password);
      router.replace('/dashboard');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.12),transparent_30%),radial-gradient(circle_at_80%_80%,rgba(217,119,6,0.10),transparent_28%),linear-gradient(135deg,#050505_0%,#080808_48%,#050505_100%)] px-4 py-10 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30" />
      <form
        onSubmit={handleSubmit}
        className="rigx-breathing-glow relative w-full max-w-md rounded-3xl border border-orange-500/20 bg-[#151515]/90 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8"
      >
        <div className="mb-7 text-center">
          <div className="mb-4 inline-flex rounded-full border border-orange-500/20 bg-[#1F160E] px-4 py-1 text-xs font-medium uppercase tracking-[0.22em] text-[#D88A32]">
            RIGX
          </div>
          <h1 className="text-2xl font-semibold tracking-wide text-white sm:text-3xl">Welcome to RIGX SYSTEM</h1>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.24em] text-[#D88A32]">
            REPAIR INTELLIGENCE & GENIUS EXPERIENCE
          </p>
          <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
            PLEASE SIGN IN TO ACCESS YOUR DASHBOARD
          </p>
        </div>

        <label className="block text-sm text-zinc-300">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-[#101010] px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-orange-500/40 focus:shadow-[0_0_24px_rgba(249,115,22,0.10)]"
          />
        </label>

        <label className="mt-5 block text-sm text-zinc-300">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-[#101010] px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-orange-500/40 focus:shadow-[0_0_24px_rgba(249,115,22,0.10)]"
          />
        </label>

        {error ? <div className="mt-5 rounded-2xl border border-red-500/25 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting}
          className="mt-7 h-12 w-full rounded-2xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 text-sm font-semibold text-white shadow-[0_0_26px_rgba(249,115,22,0.14)] transition hover:from-[#D97706] hover:to-[#FB923C] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
