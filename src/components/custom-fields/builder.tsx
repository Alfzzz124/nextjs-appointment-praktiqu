/**
 * Field builder — a form for creating or editing a CustomField definition.
 *
 * Used in the Settings → Custom Fields admin panel (spec 016, US1).
 */

'use client';

import { useState } from 'react';
import { FIELD_TYPES, MODULE_TYPES, type FieldType } from '@/services/custom-fields/service';

export interface FieldBuilderValues {
  moduleType: string;
  fieldLabel: string;
  fieldType: FieldType;
  isRequired: boolean;
  options: string[];
  placeholder: string;
  order: number;
}

interface FieldBuilderProps {
  initialValues?: Partial<FieldBuilderValues>;
  onSubmit: (values: FieldBuilderValues) => void;
  onCancel?: () => void;
  /** 'create' shows the entity type selector; 'update' locks it */
  mode?: 'create' | 'update';
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  textarea: 'Long Text',
  number: 'Number',
  date: 'Date',
  select: 'Single Select',
  'multi-select': 'Multi Select',
  boolean: 'Yes / No',
  email: 'Email',
  phone: 'Phone',
};

export default function FieldBuilder({
  initialValues = {},
  onSubmit,
  onCancel,
  mode = 'create',
}: FieldBuilderProps) {
  const [moduleType, setModuleType] = useState(initialValues.moduleType ?? 'client');
  const [fieldLabel, setFieldLabel] = useState(initialValues.fieldLabel ?? '');
  const [fieldType, setFieldType] = useState<FieldType>(initialValues.fieldType ?? 'text');
  const [isRequired, setIsRequired] = useState(initialValues.isRequired ?? false);
  const [options, setOptions] = useState<string[]>(initialValues.options ?? []);
  const [newOption, setNewOption] = useState('');
  const [placeholder, setPlaceholder] = useState(initialValues.placeholder ?? '');
  const [order, setOrder] = useState(initialValues.order ?? 0);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = fieldType === 'select' || fieldType === 'multi-select';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fieldLabel.trim()) {
      setError('Label is required');
      return;
    }
    if (needsOptions && options.length === 0) {
      setError('Options are required for select fields');
      return;
    }
    onSubmit({
      moduleType,
      fieldLabel: fieldLabel.trim(),
      fieldType,
      isRequired,
      options: needsOptions ? options : [],
      placeholder: placeholder.trim(),
      order,
    });
  }

  function addOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    if (options.includes(trimmed)) return;
    setOptions((prev) => [...prev, trimmed]);
    setNewOption('');
  }

  function removeOption(o: string) {
    setOptions((prev) => prev.filter((x) => x !== o));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Entity type */}
      {mode === 'create' && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Applies to</span>
          <select
            value={moduleType}
            onChange={(e) => setModuleType(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {MODULE_TYPES.map((m) => (
              <option key={m} value={m}>
                {m === 'client' ? 'Client' : m === 'appointment' ? 'Appointment' : 'Session Note'}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Label */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Field Label</span>
        <input
          type="text"
          value={fieldLabel}
          onChange={(e) => setFieldLabel(e.target.value)}
          placeholder="e.g. Emergency Contact"
          maxLength={200}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </label>

      {/* Field type */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Field Type</span>
        <select
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldType)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </label>

      {/* Options */}
      {needsOptions && (
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Options</span>
          <div className="mb-2 flex gap-2">
            <input
              type="text"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addOption(); }
              }}
              placeholder="Add an option…"
              className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={addOption}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Add
            </button>
          </div>
          <ul className="space-y-1">
            {options.map((o) => (
              <li key={o} className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5 text-sm">
                <span>{o}</span>
                <button
                  type="button"
                  onClick={() => removeOption(o)}
                  className="text-red-500 hover:text-red-700"
                  aria-label={`Remove ${o}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Placeholder */}
      {(fieldType === 'text' || fieldType === 'textarea' || fieldType === 'email' || fieldType === 'phone') && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Placeholder</span>
          <input
            type="text"
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            maxLength={255}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
      )}

      {/* Required */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isRequired}
          onChange={(e) => setIsRequired(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-gray-700">Required</span>
      </label>

      {/* Order */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Display Order</span>
        <input
          type="number"
          value={order}
          onChange={(e) => setOrder(Number(e.target.value))}
          min={0}
          max={10000}
          className="w-32 rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </label>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {mode === 'create' ? 'Create Field' : 'Save Changes'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
