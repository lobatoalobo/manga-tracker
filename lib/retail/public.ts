/**
 * Infra de Retail — LECTURA pública de una campaña publicada (sin sesión, sin autorización de miembro).
 * Solo son públicas las campañas PUBLISHED o CLOSED de una tienda comercial HABILITADA; DRAFT y CANCELLED
 * NO se exponen (§16, decisión documentada). Devuelve solo ofertas ACTIVE + descuento derivado + etiqueta
 * de disponibilidad temporal (`now` inyectado). No hay botón de reservar (Slice 3).
 */
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import {
  CAMPAIGN_STATUS,
  publicAvailabilityLabel,
  type CampaignStatus,
} from "@/lib/domain/retail/campaign";
import { OFFER_STATUS, derivedDiscountPercent } from "@/lib/domain/retail/offer";

type Client = Pick<PrismaClient, "storeCommerceProfile" | "preorderCampaign">;

export interface PublicOfferView {
  id: number;
  volumeId: number | null; // null = oferta manual (lanzamiento aún no catalogado)
  title: string;
  volumeNumber: number | null;
  publisher: string | null;
  listPriceCents: number;
  preorderPriceCents: number;
  discountPercent: number;
}
export interface PublicCampaignView {
  storeName: string;
  storeSlug: string;
  title: string;
  description: string | null;
  weekLabel: string | null;
  status: CampaignStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  availability: "OPEN" | "NOT_YET" | "ENDED" | "CLOSED";
  offers: PublicOfferView[];
}

/** Campaña pública por (slug, campaignId) o null si no corresponde exponerla. */
export async function getPublicCampaign(
  slug: string,
  campaignId: number,
  now: Date = new Date(),
  client: Client = prisma,
): Promise<PublicCampaignView | null> {
  const profile = await client.storeCommerceProfile.findUnique({
    where: { slug },
    select: { storeId: true, enabled: true, store: { select: { name: true } } },
  });
  if (!profile || !profile.enabled) return null; // tienda no comercial o deshabilitada → no pública

  const c = await client.preorderCampaign.findUnique({
    where: { id: campaignId },
    include: { offers: { where: { status: OFFER_STATUS.ACTIVE }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  if (!c || c.storeId !== profile.storeId) return null; // no existe o es de otra tienda
  const status = c.status as CampaignStatus;
  if (status !== CAMPAIGN_STATUS.PUBLISHED && status !== CAMPAIGN_STATUS.CLOSED) return null; // DRAFT/CANCELLED no son públicas

  return {
    storeName: profile.store.name,
    storeSlug: slug,
    title: c.title,
    description: c.description,
    weekLabel: c.weekLabel,
    status,
    opensAt: c.opensAt,
    closesAt: c.closesAt,
    availability: publicAvailabilityLabel({ status, opensAt: c.opensAt, closesAt: c.closesAt, storeEnabled: true }, now),
    offers: c.offers.map((o) => ({
      id: o.id,
      volumeId: o.volumeId,
      title: o.titleSnapshot,
      volumeNumber: o.volumeNumberSnapshot,
      publisher: o.publisherSnapshot,
      listPriceCents: o.listPriceCents,
      preorderPriceCents: o.preorderPriceCents,
      discountPercent: derivedDiscountPercent(o.listPriceCents, o.preorderPriceCents),
    })),
  };
}
