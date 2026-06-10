import { searchMangaList, getMangaById } from "../lib/anilist";
import { getIvreaEdition } from "../lib/providers/ivrea";
import { getPaniniEdition } from "../lib/providers/panini";

// --- MangaUpdates (inline, todavía no es provider) ---
interface MUFormat { count: number; label: string; complete: boolean; }
async function getMU(title: string): Promise<{ muTitle: string; formats: MUFormat[] } | null> {
  const s = await fetch("https://api.mangaupdates.com/v1/series/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: title, perpage: 1 }),
  });
  if (!s.ok) return null;
  const id = (await s.json()).results?.[0]?.record?.series_id;
  if (!id) return null;
  const dj = await (await fetch("https://api.mangaupdates.com/v1/series/" + id)).json();
  const formats: MUFormat[] = String(dj.status || "")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+([A-Za-z\- ]+?)\s*\(/);
      return m ? { count: Number(m[1]), label: m[2].trim(), complete: /complete/i.test(line) } : null;
    })
    .filter((x): x is MUFormat => x !== null);
  return { muTitle: dj.title, formats };
}

const TITLES = [
  "One Piece","Naruto","Bleach","Death Note","Dragon Ball","My Hero Academia",
  "Chainsaw Man","Spy x Family","Jujutsu Kaisen","Dandadan","Witch Hat Atelier",
  "Bakemonogatari","20th Century Boys","Tokyo Ghoul","Berserk","Vagabond",
  "Demon Slayer","Hunter x Hunter","Vinland Saga","Monster","Kaguya-sama",
  "One Punch Man","Boruto","Frieren","Blue Lock",
];

function fmtMU(f: MUFormat[]) { return f.map((x) => `${x.count} ${x.label}`).join(" / ") || "—"; }

async function main() {
  console.log("TÍTULO | AniList | MangaUpdates | Ivrea AR | Panini(máx/cat)");
  console.log("-".repeat(100));
  for (const t of TITLES) {
    const top = (await searchMangaList(t))[0];
    const titles = top ? [top.title.english, top.title.romaji].filter(Boolean) as string[] : [t];
    const [anilist, mu, ivrea, panini] = await Promise.all([
      top ? getMangaById(top.id).then(m => m.volumes).catch(() => null) : null,
      getMU(titles[0]).catch(() => null),
      getIvreaEdition(titles).catch(() => null),
      getPaniniEdition(titles).catch(() => null),
    ]);
    console.log(
      `${t} | AL:${anilist ?? "—"} | MU:${mu ? fmtMU(mu.formats) : "—"} | Ivrea:${ivrea?.argentinaVolumes ?? "—"} | Panini:${panini ? panini.totalVolumes + "/" + panini.listed : "—"}`
    );
  }
}
main().finally(() => process.exit(0));
