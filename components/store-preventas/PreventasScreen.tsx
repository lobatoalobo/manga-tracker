import { StoreShell } from "@/components/store-home/StoreShell";
import { KpiCard } from "@/components/store-home/KpiCard";
import { PREVENTA_KPIS } from "./mock-preventas";
import { PreordersHeader } from "./PreordersHeader";
import { PreordersToolbar } from "./PreordersToolbar";
import { PreorderList } from "./PreorderList";
import { PreordersPagination } from "./PreordersPagination";

/**
 * Home del módulo Preventas: mismo shell que el Home (sidebar + contenido claro), con "Preventas" activo.
 * Encabezado + resumen de KPIs + barra de filtros + lista de preventas + paginación. Solo estructura visual (mock).
 */
export function PreventasScreen() {
  return (
    <StoreShell active="preventas">
      <PreordersHeader />

      {/* Resumen: seis KPIs (mismos tamaños que el Home) */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {PREVENTA_KPIS.map((k, i) => <KpiCard key={i} kpi={k} />)}
      </div>

      <PreordersToolbar />
      <PreorderList />
      <PreordersPagination />
    </StoreShell>
  );
}
