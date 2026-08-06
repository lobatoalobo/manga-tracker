import { PREORDER_ROWS } from "./mock-preventas";
import { PreorderListItem } from "./PreorderListItem";

/** Lista de preventas: ocupa todo el ancho, una tarjeta por preventa. */
export function PreorderList() {
  return (
    <div className="space-y-3">
      {PREORDER_ROWS.map((row) => (
        <PreorderListItem key={row.id} row={row} />
      ))}
    </div>
  );
}
