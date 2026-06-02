// src/app/(dashboard)/settings/notes-templates/page.tsx
import Link from 'next/link';

export default function NotesTemplatesPage() {
  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Note Templates</h1>
        <Link
          href="/settings/notes-templates/new"
          className="rounded bg-primary-600 px-3 py-2 text-white"
        >
          New Template
        </Link>
      </header>
      <p className="text-sm text-gray-600">
        Manage reusable note templates with variable placeholders. See{' '}
        <Link href="/settings/notes-templates" className="text-primary-600 underline">
          editor
        </Link>{' '}
        to create or update.
      </p>
    </div>
  );
}
