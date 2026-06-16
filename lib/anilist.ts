export async function searchManga(search: string) {
  const query = `
    query ($search: String) {
      Media(search: $search, type: MANGA) {
        id

        title {
          romaji
          english
          native
        }

        coverImage {
          extraLarge
          large
          medium
        }

        bannerImage

        description(asHtml: false)

        genres

        averageScore

        popularity

        favourites

        format

        status

        volumes

        chapters

        countryOfOrigin

        startDate {
          year
          month
          day
        }

        endDate {
          year
          month
          day
        }

        staff {
          edges {
            role

            node {
              name {
                full
              }
            }
          }
        }

        characters(
          sort: ROLE,
          perPage: 10
        ) {
          edges {
            role

            node {
              name {
                full
              }

              image {
                large
              }
            }

            voiceActors(
              language: JAPANESE
            ) {
              name {
                full
              }

              image {
                large
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          search,
        },
      }),
    },
  );

  const json =
    await response.json();

  return json.data.Media;
}

export async function searchMangaList(
  search: string,
  includeAdult = true,
) {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(
          search: $search,
          type: MANGA${includeAdult ? "" : ",\n          isAdult: false"}
        ) {
          id

          title {
            romaji
            english
            native
          }

          coverImage {
            large
          }

          staff(perPage: 1, sort: RELEVANCE) { nodes { name { full } } }

          status

          isAdult
        }
      }
    }
  `;

  const body = JSON.stringify({ query, variables: { search } });

  // Reintenta ante 429 (rate-limit de AniList), respetando Retry-After.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      continue;
    }

    const json = await response.json();
    // Defensa: si AniList devuelve error data viene null.
    return json?.data?.Page?.media ?? [];
  }

  return [];
}

export interface SearchPage {
  media: any[];
  pageInfo: {
    total: number;
    currentPage: number;
    lastPage: number;
    hasNextPage: boolean;
  };
}

/** Búsqueda paginada (para el home): 30 por página + total de resultados. */
export async function searchMangaPage(
  search: string,
  includeAdult = true,
  page = 1,
): Promise<SearchPage> {
  const query = `
    query ($search: String, $page: Int) {
      Page(page: $page, perPage: 30) {
        pageInfo { total currentPage lastPage hasNextPage }
        media(search: $search, type: MANGA${includeAdult ? "" : ", isAdult: false"}) {
          id
          title { romaji english native }
          coverImage { large }
          staff(perPage: 1, sort: RELEVANCE) { nodes { name { full } } }
          status
          isAdult
        }
      }
    }
  `;
  const body = JSON.stringify({ query, variables: { search, page } });
  const empty: SearchPage = {
    media: [],
    pageInfo: { total: 0, currentPage: page, lastPage: page, hasNextPage: false },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => null);
    if (!res) return empty;
    if (res.status === 429 && attempt < 2) {
      const ra = Number(res.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (ra + 1) * 1000));
      continue;
    }
    const json = await res.json().catch(() => null);
    const Page = json?.data?.Page;
    if (!Page) return empty;
    return { media: Page.media ?? [], pageInfo: Page.pageInfo ?? empty.pageInfo };
  }
  return empty;
}

/**
 * Top de mangas "hot" del momento (trending de AniList).
 * Cacheado 1 semana: se refresca solo, sin cron.
 */
/**
 * Manga de un autor buscándolo por nombre (Staff). Sirve para mapear ediciones
 * cuyo título está solo en español (no matchea la búsqueda por título), usando
 * el autor que da Whakoom.
 */
export async function searchStaffManga(
  name: string,
): Promise<{ id: number; title: { romaji?: string | null; english?: string | null } }[]> {
  const query = `
    query ($s: String) {
      Staff(search: $s) {
        staffMedia(type: MANGA, sort: POPULARITY_DESC, perPage: 25) {
          nodes { id title { romaji english } }
        }
      }
    }
  `;
  const body = JSON.stringify({ query, variables: { s: name } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      continue;
    }
    const json = await response.json();
    return json?.data?.Staff?.staffMedia?.nodes ?? [];
  }
  return [];
}

export async function getTrendingManga(includeAdult = true) {
  const query = `
    query {
      Page(page: 1, perPage: 10) {
        media(type: MANGA, sort: TRENDING_DESC${includeAdult ? "" : ", isAdult: false"}) {
          id
          title { romaji english native }
          coverImage { large }
          staff(perPage: 1, sort: RELEVANCE) { nodes { name { full } } }
        }
      }
    }
  `;

  // Resiliente: reintenta ante 429 y nunca tira (peor caso, lista vacía) para
  // no romper el home si AniList falla.
  const body = JSON.stringify({ query });
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      next: { revalidate: 60 * 60 * 24 * 7 }, // 1 semana
    }).catch(() => null);

    if (!response) return [];
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      continue;
    }
    const json = await response.json().catch(() => null);
    return json?.data?.Page?.media ?? [];
  }
  return [];
}

/** Obras (manga) de un autor/staff. */
export async function getStaffWorks(id: number) {
  const query = `
    query ($id: Int) {
      Staff(id: $id) {
        id
        name { full }
        staffMedia(sort: POPULARITY_DESC, perPage: 50) {
          nodes {
            id
            type
            title { romaji english native }
            coverImage { large }
          }
        }
      }
    }
  `;
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id } }),
    next: { revalidate: 60 * 60 * 24 },
  });
  const json = await response.json();
  const staff = json.data?.Staff;
  if (!staff) return null;
  const works = (staff.staffMedia?.nodes ?? []).filter(
    (n: any) => n.type === "MANGA",
  );
  return { name: staff.name.full as string, works };
}

/** Listado A-Z de mangas, paginado (10 por página). */
export async function getMangaPage(
  page: number,
  includeAdult = true,
  onlyFinished = false,
) {
  const filters =
    (includeAdult ? "" : ", isAdult: false") +
    (onlyFinished ? ", status: FINISHED" : "");
  // Ordenamos por TITLE_ROMAJI: AniList resuelve TITLE_ENGLISH pésimo (muchos
  // mangas tienen english null → ordenar por ese campo con offset profundo se
  // vuelve lento y devuelve vacío). En A-Z mostramos el romaji para que el
  // orden coincida con la etiqueta.
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 10) {
        pageInfo { currentPage hasNextPage lastPage }
        media(type: MANGA, sort: TITLE_ROMAJI${filters}) {
          id
          title { romaji english native }
          coverImage { large }
          staff(perPage: 1, sort: RELEVANCE) { nodes { name { full } } }
        }
      }
    }
  `;

  const body = JSON.stringify({ query, variables: { page } });
  const fallback = {
    media: [] as any[],
    pageInfo: { currentPage: page, hasNextPage: false, lastPage: page },
  };

  // Resiliente: reintenta ante 429 y nunca tira (peor caso, lista vacía).
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      next: { revalidate: 60 * 60 * 24 },
    }).catch(() => null);

    if (!response) return fallback;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      continue;
    }

    const json = await response.json().catch(() => null);
    const Page = json?.data?.Page;
    return {
      media: Page?.media ?? [],
      pageInfo: (Page?.pageInfo ?? fallback.pageInfo) as {
        currentPage: number;
        hasNextPage: boolean;
        lastPage: number;
      },
    };
  }

  return fallback;
}

/**
 * ¿La serie está en hiatus? AniList tiene un bug: el campo `status` devuelve
 * RELEASING aunque la serie esté pausada, pero el filtro `status: HIATUS` sí
 * la matchea. Así que detectamos hiatus preguntando por el filtro.
 */
export async function getHiatus(id: number): Promise<boolean> {
  const query = `query ($id: Int) { Media(id: $id, type: MANGA, status: HIATUS) { id } }`;
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id } }),
    next: { revalidate: 60 * 60 * 24 },
  });
  const json = await response.json();
  return !!json.data?.Media;
}

/** Devuelve el subconjunto de ids que están en hiatus (1 sola query). */
export async function getHiatusSet(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const query = `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: MANGA, status: HIATUS) { id } } }`;
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { ids: ids.slice(0, 50) } }),
    next: { revalidate: 60 * 60 * 24 },
  });
  const json = await response.json();
  return new Set(
    (json.data?.Page?.media ?? []).map((m: { id: number }) => m.id),
  );
}

/** Portadas (medium) de varias series en una sola query. Para thumbnails. */
export async function getMangaCovers(
  ids: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n));
  if (unique.length === 0) return out;
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          coverImage { medium large }
        }
      }
    }
  `;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { ids: unique.slice(0, 50) } }),
      next: { revalidate: 60 * 60 * 24 },
    });
    const json = await response.json();
    for (const m of json?.data?.Page?.media ?? []) {
      const url = m.coverImage?.large || m.coverImage?.medium;
      if (url) out.set(m.id, url);
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/** Total de tomos en AniList (japonés/original) por id. Para auditar conteos. */
export async function getMangaVolumes(
  ids: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const unique = [...new Set(ids)].filter((n) => Number.isFinite(n));
  if (unique.length === 0) return out;
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: MANGA) { id volumes }
      }
    }
  `;
  for (let i = 0; i < unique.length; i += 50) {
    try {
      const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { ids: unique.slice(i, i + 50) } }),
        next: { revalidate: 60 * 60 * 24 },
      });
      const json = await response.json();
      for (const m of json?.data?.Page?.media ?? [])
        if (typeof m.volumes === "number") out.set(m.id, m.volumes);
    } catch {
      /* best-effort */
    }
  }
  return out;
}

export async function getMangaById(
  id: number,
) {
  const query = `
    query ($id: Int) {
      Media(
        id: $id,
        type: MANGA
      ) {
        id

        title {
          romaji
          english
          native
        }

        coverImage {
          extraLarge
        }

        bannerImage

        description

        genres

        averageScore

        popularity

        favourites

        format

        status

        isAdult

        volumes

        chapters

        countryOfOrigin

        externalLinks {
          url
          site
          type
          language
        }

        startDate {
          year
          month
          day
        }

        staff(sort: RELEVANCE) {
          edges {
            role

            node {
              id
              name {
                full
              }
            }
          }
        }

        relations {
          edges {
            relationType

            node {
              id
              type
              format
              isAdult
              title {
                romaji
                english
                native
              }
              coverImage {
                large
              }
            }
          }
        }

        characters(
          sort: RELEVANCE
        ) {
          edges {
            role

            node {
              name {
                full
              }

              image {
                large
              }
            }
          }
        }
      }
    }
  `;

  const body = JSON.stringify({ query, variables: { id } });

  // Resiliente: reintenta ante 429 (rate-limit) y cachea. Sin esto, navegar
  // rápido entre series tumbaba AniList → la ficha hacía notFound() (404/400)
  // sobre series VÁLIDAS. Devuelve null si AniList falla (la página decide 404).
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      next: { revalidate: 60 * 60 * 24 },
    }).catch(() => null);

    if (!response) return null;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      continue;
    }

    const json = await response.json().catch(() => null);
    return json?.data?.Media ?? null;
  }
  return null;
}