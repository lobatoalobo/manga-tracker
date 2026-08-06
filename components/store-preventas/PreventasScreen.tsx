import { StoreShell } from "@/components/store-home/StoreShell";
import { KpiCard } from "@/components/store-home/KpiCard";
import type { PreordersDashboard } from "@/lib/retail/preorders-dashboard";
import { buildKpiCards } from "./preventas-view";
import { PreordersHeader } from "./PreordersHeader";
import { PreordersToolbar } from "./PreordersToolbar";
import { PreorderList } from "./PreorderList";
import { PreordersPagination } from "./PreordersPagination";

/**
 * Home del módulo Preventas con DATOS REALES: mismo shell que el Home (sidebar + contenido claro), con
 * "Preventas" activo. Encabezado + indicadores + barra de filtros + lista de preventas + paginación.
 */
export function PreventasScreen({ data, slug }: { data: PreordersDashboard; slug: string }) {
  const kpis = buildKpiCards(data.kpis);
  const filtered = Boolean(data.q || data.stage);
  return (
    <StoreShell active="preventas">
      <PreordersHeader slug={slug} />

      {/* Indicadores: seis KPIs (mismos tamaños que el Home) */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k, i) => <KpiCard key={i} kpi={k} />)}
      </div>

      <PreordersToolbar />
      <PreorderList rows={data.rows} slug={slug} filtered={filtered} />
      <PreordersPagination total={data.total} page={data.page} pageSize={data.pageSize} />
    </StoreShell>
  );
}
