// src/app/login/page.tsx
// Public login page for PraktiQU
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || data.title || 'Login failed');
      }

      const data = await res.json();
      // Store token in cookie (7 days)
      const maxAge = 7 * 24 * 60 * 60;
      document.cookie = `access_token=${data.access_token}; path=/; max-age=${maxAge}; samesite=lax`;
      if (data.refresh_token) {
        document.cookie = `refresh_token=${data.refresh_token}; path=/; max-age=${maxAge * 2}; samesite=lax`;
      }
      router.push(returnTo);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container-low p-4">
      <div className="w-full max-w-md bg-surface rounded-xl shadow-sm p-6 md:p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <Link href="/" className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined text-3xl">spa</span>
            <span className="font-display text-2xl tracking-tight">PraktiQU</span>
          </Link>
        </div>

        <h1 className="text-center text-xl font-semibold text-on-surface mb-1">
          Welcome Back
        </h1>
        <p className="text-center text-sm text-on-surface-variant mb-6">
          Please enter your details to sign in.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-error-container text-error text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
              placeholder="name@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex items-center justify-between mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-surface bg-surface cursor-pointer"
              />
              <span className="text-sm text-on-surface-variant">Remember me</span>
            </label>
            <Link
              href="/forgot-password"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Forgot Password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 mt-2 bg-primary-container text-on-primary text-sm font-semibold rounded-lg hover:bg-surface-tint active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="text-center mt-4 text-sm text-on-surface-variant">
          Don't have an account?{' '}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
