import type { ReactNode } from 'react';
import './globals.css';

// Fase 1: shell mínimo. La Fase 2 (T2.2) añade Inter (next/font) + Metadata API.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
