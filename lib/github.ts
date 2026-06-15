const REPO = process.env.GITHUB_REPO || "lobatoalobo/manga-tracker";

export const CRAWL_JOBS = [
  "ivrea",
  "panini",
  "ovni",
  "mangakas",
  "resolve",
  "whakoom-ovni",
  "whakoom-panini",
  "whakoom-ovni-baseline",
  "whakoom-panini-baseline",
] as const;

export type CrawlJob = (typeof CRAWL_JOBS)[number];

export const ACTIONS_URL = `https://github.com/${REPO}/actions/workflows/crawl.yml`;

/**
 * Dispara el workflow `crawl.yml` en GitHub Actions (corre el crawl en un runner
 * contra la DB de prod, sin el límite de 60s de Vercel). Requiere GH_DISPATCH_TOKEN
 * (fine-grained PAT con Actions: read/write).
 */
export async function dispatchCrawl(
  job: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return { ok: false, error: "Falta GH_DISPATCH_TOKEN" };
  if (!CRAWL_JOBS.includes(job as CrawlJob))
    return { ok: false, error: `Job inválido: ${job}` };

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/crawl.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "nakama",
      },
      body: JSON.stringify({ ref: "main", inputs: { job } }),
    },
  ).catch(() => null);

  if (res && res.status === 204) return { ok: true };
  const detail = res ? `${res.status}: ${(await res.text()).slice(0, 200)}` : "sin respuesta";
  return { ok: false, error: `GitHub ${detail}` };
}
