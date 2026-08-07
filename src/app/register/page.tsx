// src/app/register/page.tsx
// Public registration page for PraktiQU
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: '',
    firstName: '',
    lastName: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Basic validation
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      // Registration signs the patient in, so there is no second login round-trip.
      const res = await fetch('/api/v1/public/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          ...(formData.contactNumber ? { contactNumber: formData.contactNumber } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.title || 'Registration failed');
      }

      const maxAge = 7 * 24 * 60 * 60;
      document.cookie = `access_token=${data.accessToken}; path=/; max-age=${maxAge}; samesite=lax`;
      if (data.refreshToken) {
        document.cookie = `refresh_token=${data.refreshToken}; path=/; max-age=${maxAge * 2}; samesite=lax`;
      }
      router.push('/dashboard');
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
          Create Account
        </h1>
        <p className="text-center text-sm text-on-surface-variant mb-6">
          Join us to book appointments and manage your sessions.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-error-container text-error text-sm rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">
                First Name
              </label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
                placeholder="John"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">
                Last Name
              </label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
                placeholder="Doe"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Phone Number <span className="font-normal text-on-surface-variant">(optional)</span>
            </label>
            <input
              type="tel"
              name="contactNumber"
              value={formData.contactNumber}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
              placeholder="081234567890"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Email Address
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
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
              name="password"
              value={formData.password}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none transition-shadow"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 mt-2 bg-primary-container text-on-primary text-sm font-semibold rounded-lg hover:bg-surface-tint active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center mt-4 text-sm text-on-surface-variant">
          Already have an account?{' '}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}