export interface StarRatingDisplayProps {
  value: number;
  mode: 'average' | 'item';
}

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * Marca visual de calificación de sólo lectura (`design.md` §D3). Nunca
 * comparte componente con `StarRatingInput`: acá no hay ningún rol
 * interactivo — exponer `radio`/`button` de sólo-lectura sería un control
 * falso.
 *
 * `mode="average"` es para el resumen (AC-3): "Calificación promedio: {n} de
 * 5". `mode="item"` es para cada reseña individual de la lista: "{n} de 5
 * estrellas" (mismo copy que `StarRatingInput`, pero sin interactividad).
 */
export function StarRatingDisplay({ value, mode }: StarRatingDisplayProps) {
  const formatted = formatRatingNumber(value);
  const label =
    mode === 'average'
      ? `Calificación promedio: ${formatted} de 5`
      : `${formatted} de 5 estrellas`;

  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5">
      {RATINGS.map((n) => (
        <span
          key={n}
          aria-hidden="true"
          className={`text-base leading-none ${
            n <= Math.round(value) ? 'text-warning' : 'text-muted'
          }`}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function formatRatingNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
