'use client';

/**
 * Professional create/edit form component.
 * US1: create form, US2: edit form with read-only fields
 *
 * T027: all required fields
 * T031/T032: read-only fields for SIP/SIK and professional type (self-edit)
 */

import { useState } from 'react';
import type { ProfessionalType } from '@prisma/client';
import type { ContactInfo } from '@/types/professional';

const PROFESSIONAL_TYPE_OPTIONS: Array<{ value: ProfessionalType; label: string }> = [
  { value: 'PSIKOLOG_KLINIS', label: 'Psikolog Klinis' },
  { value: 'PSIKOLOG_ANAK', label: 'Psikolog Anak' },
  { value: 'PSIKIATER', label: 'Psikiater' },
  { value: 'KONSELOR', label: 'Konselor' },
];

interface ProfessionalFormProps {
  /** Initial data for edit mode */
  initial?: {
    fullName?: string;
    email?: string;
    professionalType?: ProfessionalType;
    registrationNumber?: string;
    biography?: string;
    specialties?: string[];
    contactInfo?: ContactInfo;
    practiceId?: string;
  };
  /** If true, SIP/SIK and professional type are read-only (self-edit mode) */
  readOnlyFields?: boolean;
  /** Submit handler */
  onSubmit: (data: FormData) => Promise<void>;
}

export interface FormData {
  fullName: string;
  email: string;
  professionalType: ProfessionalType;
  registrationNumber: string;
  practiceId?: string;
  biography?: string;
  specialties?: string[];
  contactInfo?: ContactInfo;
}

interface ValidationErrors {
  [field: string]: string[];
}

export function ProfessionalForm({ initial, readOnlyFields = false, onSubmit }: ProfessionalFormProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [specialties, setSpecialties] = useState<string[]>(initial?.specialties ?? []);
  const [specialtyInput, setSpecialtyInput] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const form = e.currentTarget;
    const data: FormData = {
      fullName: (form.elements.namedItem('fullName') as HTMLInputElement)?.value ?? '',
      email: (form.elements.namedItem('email') as HTMLInputElement)?.value ?? '',
      professionalType: (form.elements.namedItem('professionalType') as HTMLSelectElement)?.value as ProfessionalType,
      registrationNumber: (form.elements.namedItem('registrationNumber') as HTMLInputElement)?.value ?? '',
      practiceId: (form.elements.namedItem('practiceId') as HTMLInputElement)?.value || undefined,
      biography: (form.elements.namedItem('biography') as HTMLTextAreaElement)?.value || undefined,
      specialties,
    };

    try {
      await onSubmit(data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'fields' in err && err.fields) {
        setErrors(err.fields as ValidationErrors);
      } else {
        setErrors({ _form: ['An error occurred. Please try again.'] });
      }
    } finally {
      setLoading(false);
    }
  }

  function addSpecialty() {
    const trimmed = specialtyInput.trim();
    if (trimmed && !specialties.includes(trimmed) && specialties.length < 20) {
      setSpecialties([...specialties, trimmed]);
      setSpecialtyInput('');
    }
  }

  function removeSpecialty(s: string) {
    setSpecialties(specialties.filter((x) => x !== s));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Error banner */}
      {errors._form && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {errors._form[0]}
        </div>
      )}

      {/* Full Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="fullName">
          Full Name <span className="text-red-500">*</span>
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          defaultValue={initial?.fullName}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Dr. Jane Doe"
        />
        {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName[0]}</p>}
      </div>

      {/* Email */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
          Email <span className="text-red-500">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={initial?.email}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="jane.doe@example.com"
        />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email[0]}</p>}
      </div>

      {/* Professional Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="professionalType">
          Professional Type <span className="text-red-500">*</span>
        </label>
        {readOnlyFields && initial?.professionalType ? (
          <div className="relative">
            <select
              id="professionalType"
              name="professionalType"
              defaultValue={initial.professionalType}
              disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            >
              {PROFESSIONAL_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400 flex items-center gap-1">
              <span>🔒</span> Changes to this field require administrator assistance
            </p>
          </div>
        ) : (
          <select
            id="professionalType"
            name="professionalType"
            required
            defaultValue={initial?.professionalType}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select type...</option>
            {PROFESSIONAL_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        {errors.professionalType && <p className="mt-1 text-xs text-red-600">{errors.professionalType[0]}</p>}
      </div>

      {/* Registration Number (SIP/SIK) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="registrationNumber">
          Registration Number (SIP/SIK) <span className="text-red-500">*</span>
        </label>
        {readOnlyFields && initial?.registrationNumber ? (
          <div className="relative">
            <input
              id="registrationNumber"
              name="registrationNumber"
              type="text"
              defaultValue={initial.registrationNumber}
              disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 font-mono cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-400 flex items-center gap-1">
              <span>🔒</span> Changes to this field require administrator assistance
            </p>
          </div>
        ) : (
          <input
            id="registrationNumber"
            name="registrationNumber"
            type="text"
            required
            defaultValue={initial?.registrationNumber}
            placeholder="PSI-12345-2024"
            pattern="^[A-Z]{2,3}-\d{5}-\d{4}$"
            title="Format: AAA-NNNNN-YYYY (e.g., PSI-12345-2024)"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        {errors.registrationNumber && <p className="mt-1 text-xs text-red-600">{errors.registrationNumber[0]}</p>}
      </div>

      {/* Biography */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="biography">
          Biography
        </label>
        <textarea
          id="biography"
          name="biography"
          rows={4}
          defaultValue={initial?.biography}
          maxLength={2000}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Brief professional background..."
        />
        {errors.biography && <p className="mt-1 text-xs text-red-600">{errors.biography[0]}</p>}
      </div>

      {/* Specialties (tags input) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {specialties.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs">
              {s}
              <button type="button" onClick={() => removeSpecialty(s)} className="hover:text-blue-900">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={specialtyInput}
            onChange={(e) => setSpecialtyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addSpecialty();
              }
            }}
            placeholder="Add a specialty..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={addSpecialty}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Add
          </button>
        </div>
        {errors.specialties && <p className="mt-1 text-xs text-red-600">{errors.specialties[0]}</p>}
      </div>

      {/* Phone */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="phone">
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={initial?.contactInfo?.phone}
          placeholder="08123456789 or +628123456789"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Professional'}
        </button>
      </div>
    </form>
  );
}