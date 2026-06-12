import { brandIcon } from "@/lib/brandIcon";

export const dynamic = "force-static";

export function GET() {
  return brandIcon(512);
}
