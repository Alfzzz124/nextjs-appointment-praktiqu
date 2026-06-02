/**
 * Settings → Custom Fields admin page (016).
 *
 * Lists all field definitions, allows creating/editing via the FieldBuilder,
 * and shows per-entity-type groupings.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import FieldBuilder, { type FieldBuilderValues } from '@/components/custom-fields/builder';
import type { FieldType } from '@/services/custom-fields/service';

interface FieldDef {
  id: string;
  moduleType: string;
  fieldLabel: string;
  fieldType: FieldType;
  options: string[] | null;
  placeholder: string | null;
  isRequired: boolean;
  order: number;
  status: number;
}

const ENTITY_LABELS: Record<string, string> = {
  client: 'Client',
  appointment: 'Appointment',
  session_note: 'Session Note',
};

const TYPE_LABELS: Record<string, string> = {
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

export default function CustomFieldsPage() {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  async function loadFields() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/custom-fields');
      if (!res.ok) throw new Error('Failed to load fields');
      const data = await res.json();
      setFields(data.items ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFields();
  }, []);

  async function handleCreate(values: FieldBuilderValues) {
    const res = await fetch('/api/v1/custom-fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.title ?? 'Failed to create field');
    }
    setShowBuilder(false);
    await loadFields();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this field? Existing values will be preserved but the field will be hidden.')) return;
    const res = await fetch(`/api/v1/custom-fields/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      alert(err.title ?? 'Failed to delete');
      return;
    }
    await loadFields();
  }

  const filtered = filterEntity === 'all' ? fields : fields.filter((f) => f.moduleType === filterEntity);
  const grouped = filtered.reduce<Record<string, FieldDef[]>>((acc, f) => {
    (acc[f.moduleType] ??= []).push(f);
    return acc;
  }, {});

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Custom Fields</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define dynamic fields for clients, appointments, and session notes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">All entities</option>
            <option value="client">Client</option>
            <option value="appointment">Appointment</option>
            <option value="session_note">Session Note</option>
          </select>
          <button
            onClick={() => { setEditingId(null); setShowBuilder(true); }}
            className="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            + New Field
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {showBuilder && (
        <div className="mb-8 rounded border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">
            {editingId ? 'Edit Field' : 'New Custom Field'}
          </h2>
          <FieldBuilder
            mode={editingId ? 'update' : 'create'}
            initialValues={editingId ? (fields.find((f) => f.id === editingId) as Partial<FieldBuilderValues>) : undefined}
            onSubmit={handleCreate}
            onCancel={() => { setShowBuilder(false); setEditingId(null); }}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-12 text-center text-gray-500">
          No custom fields{filterEntity !== 'all' ? ` for ${ENTITY_LABELS[filterEntity] ?? filterEntity}` : ''}.
          Click <strong>+ New Field</strong> to create one.
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([entityType, groupFields]) => (
            <section key={entityType}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {ENTITY_LABELS[entityType] ?? entityType}
              </h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="py-2 pr-4 font-medium text-gray-600">Label</th>
                    <th className="py-2 pr-4 font-medium text-gray-600">Type</th>
                    <th className="py-2 pr-4 font-medium text-gray-600">Required</th>
                    <th className="py-2 pr-4 font-medium text-gray-600">Options</th>
                    <th className="py-2 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupFields
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((f) => (
                      <tr key={f.id} className="border-b border-gray-100 align-top">
                        <td className="py-3 pr-4">
                          <span className="font-medium">{f.fieldLabel}</span>
                        </td>
                        <td className="py-3 pr-4 text-gray-600">
                          {TYPE_LABELS[f.fieldType] ?? f.fieldType}
                        </td>
                        <td className="py-3 pr-4">
                          {f.isRequired ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Required</span>
                          ) : (
                            <span className="text-gray-400">Optional</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-gray-500">
                          {Array.isArray(f.options) && f.options.length > 0
                            ? f.options.join(', ')
                            : '—'}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setEditingId(f.id); setShowBuilder(true); }}
                              className="text-xs text-primary-600 hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDelete(f.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}