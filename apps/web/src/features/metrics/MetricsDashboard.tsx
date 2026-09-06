'use client';

import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/observability/events';
import { RangeFilterForm } from './RangeFilterForm';
import { SalesChart } from './SalesChart';
import { TopProductsTable } from './TopProductsTable';
import { SummaryCards } from './SummaryCards';
import type { DateRange } from './metricsService';

/**
 * Orquestador del panel de métricas (US-016, `design.md` T9.1). Único estado
 * compartido: el rango aplicado. Cada widget resuelve su propio fetch — una
 * falla en uno no bloquea a los otros dos (`frontend-resilience-patterns`
 * skill, patrón #10).
 */
export function MetricsDashboard() {
  const [appliedRange, setAppliedRange] = useState<DateRange>({});
  const shown = useRef(false);

  useEffect(() => {
    if (!shown.current) {
      shown.current = true;
      track('metrics_shown');
    }
  }, []);

  function handleApply(range: DateRange) {
    setAppliedRange(range);
    track('metrics_range_changed');
  }

  return (
    <div className="flex flex-col gap-8">
      <RangeFilterForm appliedRange={appliedRange} onApply={handleApply} />
      <div data-testid="sales-chart">
        <SalesChart range={appliedRange} />
      </div>
      <div data-testid="top-products-table">
        <TopProductsTable range={appliedRange} />
      </div>
      <div data-testid="summary-cards">
        <SummaryCards range={appliedRange} />
      </div>
    </div>
  );
}
