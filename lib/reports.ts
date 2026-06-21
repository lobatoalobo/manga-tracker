import { prisma } from "@/lib/prisma";

export async function createReport(input: {
  userId?: string | null;
  mangaId?: number | null;
  mangaTitle: string;
  message: string;
}): Promise<void> {
  await prisma.report.create({
    data: {
      userId: input.userId ?? null,
      mangaId: input.mangaId ?? null,
      mangaTitle: input.mangaTitle,
      message: input.message,
    },
  });
}

export async function getReports(status?: "PENDING" | "RESOLVED") {
  return prisma.report.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function countPendingReports(): Promise<number> {
  return prisma.report.count({ where: { status: "PENDING" } });
}

export async function setReportStatus(
  id: number,
  status: "PENDING" | "RESOLVED",
): Promise<void> {
  await prisma.report.update({ where: { id }, data: { status } });
}

export async function deleteReport(id: number): Promise<void> {
  await prisma.report.delete({ where: { id } });
}
