/**
 * Skeleton dimensionado a la forma final del chart (design-system §10.1 —
 * skeleton, no spinner genérico). Se muestra mientras `next/dynamic` carga
 * el chunk de Recharts (patrón #12, `frontend-resilience-patterns` skill).
 */
export function ChartSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-80 w-full items-end gap-2 p-4">
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t bg-gray-100"
          style={{ height: `${30 + ((i * 17) % 60)}%` }}
        />
      ))}
    </div>
  );
}
