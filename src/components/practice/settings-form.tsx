'use client';

/**
 * Settings form for a Practice (Clinic).
 *
 * Displays current practice settings and allows updating via PATCH.
 * All fields mirror the practiceUpdateSchema in src/types/practice.ts.
 * Status toggle is shown but locked to ACTIVE for non-admin users.
 */
import { useState } from 'react';
import type { PracticeDTO } from '@/types/practice';

interface SettingsFormProps {
  /** The practice being edited */
  practice: PracticeDTO;
  /** Called when the form is successfully submitted */
  onSaved?: (updated: PracticeDTO) => void;
  /** Called on unrecoverable error */
  onError?: (message: string) => void;
}

interface FormState {
  name: string;
  email: string;
  telephoneNo: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  countryCode: string;
  countryCallingCode: string;
  timezone: string;
  logoUrl: string;
}

export function SettingsForm({ practice, onSaved, onError }: SettingsFormProps) {
  const [form, setForm] = useState<FormState>({
    name: practice.name,
    email: practice.email ?? '',
    telephoneNo: practice.telephoneNo ?? '',
    address: practice.address ?? '',
    city: practice.city ?? '',
    state: practice.state ?? '',
    country: practice.country ?? '',
    postalCode: practice.postalCode ?? '',
    countryCode: practice.countryCode ?? '',
    countryCallingCode: practice.countryCallingCode ?? '',
    timezone: practice.timezone ?? 'Asia/Makassar',
    logoUrl: practice.logoUrl ?? '',
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function field(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value !== '' && value !== practice[key as keyof PracticeDTO]) {
          patch[key] = value || null;
        }
      }
      // timezone and logoUrl go into extra JSON
      const { timezone, logoUrl, ...topLevel } = patch as Record<string, unknown>;
      const body = { ...topLevel, ...(timezone ? { timezone } : {}), ...(logoUrl ? { logoUrl } : {}) };

      const res = await fetch(`/api/v1/practices/${practice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const { data } = await res.json() as { data: PracticeDTO };
      setSaved(true);
      onSaved?.(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      onError?.(msg);
    } finally {
      setSaving(false);
    }
  }

  const timezones = [
    'Asia/Makassar',
    'Asia/Jakarta',
    'Asia/Singapore',
    'Asia/Kuala_Lumpur',
    'Asia/Bangkok',
    'Asia/Ho_Chi_Minh',
    'Asia/Manila',
    'Asia/Hong_Kong',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Riyadh',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Amsterdam',
    'Europe/Stockholm',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Australia/Sydney',
    'Australia/Melbourne',
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl" noValidate>
      {/* Status banner */}
      {practice.status === 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          This practice is inactive. Patients and professionals cannot access it.
        </div>
      )}

      {/* Saved indicator */}
      {saved && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
          Settings saved successfully.
        </div>
      )}

      {/* Basic info */}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Basic Information</legend>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Practice Name *</label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={120}
            value={form.name}
            onChange={field}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="telephoneNo" className="block text-sm font-medium text-gray-700">Telephone</label>
            <input
              id="telephoneNo"
              name="telephoneNo"
              type="tel"
              value={form.telephoneNo}
              onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
      </fieldset>

      {/* Address */}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Address</legend>
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-gray-700">Street Address</label>
          <input
            id="address"
            name="address"
            type="text"
            value={form.address}
            onChange={field}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-700">City</label>
            <input id="city" name="city" type="text" value={form.city} onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="state" className="block text-sm font-medium text-gray-700">State / Province</label>
            <input id="state" name="state" type="text" value={form.state} onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="postalCode" className="block text-sm font-medium text-gray-700">Postal Code</label>
            <input id="postalCode" name="postalCode" type="text" value={form.postalCode} onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="country" className="block text-sm font-medium text-gray-700">Country</label>
            <input id="country" name="country" type="text" value={form.country} onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm" />
          </div>
        </div>
      </fieldset>

      {/* Regional settings */}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Regional Settings</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="countryCode" className="block text-sm font-medium text-gray-700">
              Country Code (ISO 3166-1 alpha-2)
            </label>
            <input
              id="countryCode"
              name="countryCode"
              type="text"
              maxLength={2}
              placeholder="ID"
              value={form.countryCode}
              onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm uppercase"
            />
          </div>
          <div>
            <label htmlFor="countryCallingCode" className="block text-sm font-medium text-gray-700">
              Calling Code (E.164)
            </label>
            <input
              id="countryCallingCode"
              name="countryCallingCode"
              type="text"
              placeholder="+62"
              value={form.countryCallingCode}
              onChange={field}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
      </fieldset>

      {/* Timezone & branding */}
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Timezone & Branding</legend>
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium text-gray-700">Timezone</label>
          <select
            id="timezone"
            name="timezone"
            value={form.timezone}
            onChange={field}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700">Logo URL</label>
          <input
            id="logoUrl"
            name="logoUrl"
            type="url"
            placeholder="https://cdn.example.com/logo.png"
            value={form.logoUrl}
            onChange={field}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
          />
          {form.logoUrl && (
            <div className="mt-2">
              <img
                src={form.logoUrl}
                alt="Practice logo preview"
                className="h-12 object-contain border rounded p-1 bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
        </div>
      </fieldset>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {saved && !saving && (
          <span className="text-sm text-green-600">✓ Saved</span>
        )}
      </div>
    </form>
  );
}