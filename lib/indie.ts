import { prisma } from "@/lib/prisma";

export interface IndieWorkInput {
  title: string;
  author: string;
  synopsis?: string | null;
  coverUrl?: string | null;
  buyUrl?: string | null;
  social?: string | null;
}

export async function getApprovedIndieWorks() {
  return prisma.indieWork.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPendingIndieWorks() {
  return prisma.indieWork.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

export async function countPendingIndieWorks(): Promise<number> {
  return prisma.indieWork.count({ where: { status: "PENDING" } });
}

export async function createIndieWork(
  input: IndieWorkInput,
  opts: { status?: "APPROVED" | "PENDING"; submittedBy?: string | null } = {},
) {
  await prisma.indieWork.create({
    data: {
      title: input.title.trim(),
      author: input.author.trim(),
      synopsis: clean(input.synopsis),
      coverUrl: clean(input.coverUrl),
      buyUrl: clean(input.buyUrl),
      social: clean(input.social),
      status: opts.status ?? "PENDING",
      submittedBy: opts.submittedBy ?? null,
    },
  });
}

export async function setIndieWorkStatus(
  id: number,
  status: "APPROVED" | "PENDING",
) {
  await prisma.indieWork.update({ where: { id }, data: { status } });
}

export async function deleteIndieWork(id: number) {
  await prisma.indieWork.delete({ where: { id } });
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}
