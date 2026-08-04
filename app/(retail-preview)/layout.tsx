import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { retailPreviewEnabled } from "./gate";
import "./retail-theme.css";

// Segmento AISLADO (route-group `(retail-preview)`): no altera el nesting de las
// rutas reales ni el tema global. Solo existe cuando RETAIL_PREVIEW_ENABLED=true.
export const metadata: Metadata = {
  title: "Retail UI Kit",
  robots: { index: false, follow: false },
};

export default function RetailPreviewLayout({ children }: { children: ReactNode }) {
  if (!retailPreviewEnabled()) notFound();
  return <>{children}</>;
}
