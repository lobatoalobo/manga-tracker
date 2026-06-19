"use client";

import { useRef } from "react";
import MangaCard from "@/components/MangaCard";
import type { CollectionItem } from "@/lib/collection";

/**
 * Carrusel horizontal de "Continuar colección": muestra ~2 cards en mobile y ~5
 * en desktop, con flechas para recorrer TODAS las series incompletas. Scroll
 * nativo con snap (swipe en mobile) + botones en desktop.
 */
export default function ContinueCarousel({ items }: { items: CollectionItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((i) => (
          <div
            key={`${i.anilistId}-${i.edition.key}`}
            className="w-[calc(50%-0.5rem)] shrink-0 snap-start sm:w-[calc(33.333%-0.667rem)] md:w-[calc(20%-0.8rem)]"
          >
            <MangaCard item={i} readOnly />
          </div>
        ))}
      </div>

      {items.length > 2 && (
        <>
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Anterior"
            className="absolute left-0 top-[40%] hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-surface/95 p-2 text-lg leading-none shadow transition hover:border-accent hover:text-accent sm:block"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Siguiente"
            className="absolute right-0 top-[40%] hidden -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-surface/95 p-2 text-lg leading-none shadow transition hover:border-accent hover:text-accent sm:block"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
