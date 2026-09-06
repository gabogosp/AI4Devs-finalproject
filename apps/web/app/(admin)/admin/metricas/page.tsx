import { MetricsDashboard } from '@/features/metrics/MetricsDashboard';

/**
 * Server Component delgado (US-016) — mismo estilo que `admin/ordenes/page.tsx`.
 * El `AdminGuard` y el `X-Robots-Tag: noindex` los hereda del route group
 * `(admin)`, cero configuración nueva.
 */
export default function Page() {
  return (
    <section className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Métricas</h1>
      <MetricsDashboard />
    </section>
  );
}
