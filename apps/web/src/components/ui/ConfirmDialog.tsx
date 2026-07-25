'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { Field, Input } from './Field';

/**
 * Confirmación destructiva de dos pasos (§11.bis.5): NO cierra por click-outside;
 * exige escribir la palabra de confirmación; Esc cancela; el foco entra al input
 * al abrir. `role="dialog"` + `aria-modal`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmWord,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmWord: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setTyped('');
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = typed === confirmWord;

  return (
    <div className="fixed inset-0 z-overlay flex items-center justify-center bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="z-modal flex max-w-md flex-col gap-4 rounded-lg bg-surface p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <p className="text-sm text-muted">{description}</p>
        <Field label={`Escribí "${confirmWord}" para confirmar`}>
          {({ inputId, describedBy }) => (
            <Input
              ref={inputRef}
              id={inputId}
              aria-describedby={describedBy}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
