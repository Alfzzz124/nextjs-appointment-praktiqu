/**
 * FieldInput — renders a single custom field input for use inside a form.
 *
 * Source of truth: specs/016-custom-fields/spec.md
 *
 * Handles all 9 field types with appropriate HTML inputs.
 * Required indicator is shown for required fields.
 */

'use client';

import { useId } from 'react';

export interface FieldInputProps {
  /** The field definition */
  field: {
    id: string;
    fieldLabel: string;
    fieldType: string;
    options: string[] | null;
    placeholder: string | null;
    isRequired: boolean;
  };
  /** Current value — shape depends on fieldType */
  value: unknown;
  /** Called on every change */
  onChange: (value: unknown) => void;
  /** Set when the form containing this input is invalid */
  error?: string | null;
  /** Disable the input */
  disabled?: boolean;
}

export default function FieldInput({ field, value, onChange, error, disabled }: FieldInputProps) {
  const id = useId();
  const required = field.isRequired;
  const placeholder = field.placeholder ?? '';

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const t = e.target;
    if (t.type === 'checkbox') {
      onChange((t as HTMLInputElement).checked);
    } else if (field.fieldType === 'number') {
      const n = parseFloat(t.value);
      onChange(Number.isNaN(n) ? '' : n);
    } else {
      onChange(t.value);
    }
  }

  const baseClass = `w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
    error
      ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
  }`;
  const labelClass = 'mb-1 block text-sm font-medium text-gray-700';
  const hintClass = 'mt-1 text-xs text-gray-400';

  const inputProps = {
    id,
    name: field.id,
    required,
    placeholder,
    disabled,
    className: baseClass,
    onChange: handleChange,
  };

  function renderInput() {
    switch (field.fieldType) {
      case 'text':
      case 'email':
      case 'phone':
        return <input {...inputProps} type={field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'} value={String(value ?? '')} onChange={handleChange} />;

      case 'textarea':
        return (
          <textarea
            id={id}
            name={field.id}
            required={required}
            placeholder={placeholder}
            disabled={disabled}
            value={String(value ?? '')}
            onChange={handleChange}
            rows={4}
            className={baseClass}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            {...inputProps}
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={handleChange}
          />
        );

      case 'date':
        return (
          <input
            type="date"
            {...inputProps}
            value={String(value ?? '')}
            onChange={handleChange}
          />
        );

      case 'boolean':
        return (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              id={id}
              name={field.id}
              disabled={disabled}
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">{placeholder || 'Yes'}</span>
          </label>
        );

      case 'select': {
        const opts = field.options ?? [];
        return (
          <select
            id={id}
            name={field.id}
            required={required}
            disabled={disabled}
            value={String(value ?? '')}
            onChange={handleChange}
            className={baseClass}
          >
            <option value="">Select…</option>
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      }

      case 'multi-select': {
        const opts = field.options ?? [];
        const selected = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-1">
            {opts.map((o) => (
              <label key={o} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.includes(o)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...selected, o]);
                    } else {
                      onChange(selected.filter((v) => v !== o));
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">{o}</span>
              </label>
            ))}
          </div>
        );
      }

      default:
        return (
          <input type="text" {...inputProps} value={String(value ?? '')} onChange={handleChange} />
        );
    }
  }

  return (
    <div className="space-y-1">
      {field.fieldType !== 'boolean' && (
        <label htmlFor={id} className={labelClass}>
          {field.fieldLabel}
          {required && <span aria-hidden className="ml-1 text-red-500">*</span>}
        </label>
      )}
      {renderInput()}
      {field.fieldType !== 'boolean' && required && (
        <p className={hintClass}>Required</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}