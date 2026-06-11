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
        }
      }
    }
  `;

  const response =
    await fetch(
      "https://graphql.anilist.co",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify(
          {
            query,

            variables: {
              search,
            },
          },
        ),
      },
    );

  const json =
    await response.json();

  return json.data.Page
    .media;
}

/**
 * Top de mangas "hot" del momento (trending de AniList).
 * Cacheado 1 semana: se refresca solo, sin cron.
 */
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

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    next: { revalidate: 60 * 60 * 24 * 7 }, // 1 semana
  });

  const json = await response.json();
  return json.data.Page.media;
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
            title { romaji native }
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
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 10) {
        pageInfo { currentPage hasNextPage }
        media(type: MANGA, sort: TITLE_ROMAJI${filters}) {
          id
          title { romaji english native }
          coverImage { large }
          staff(perPage: 1, sort: RELEVANCE) { nodes { name { full } } }
        }
      }
    }
  `;

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { page } }),
    next: { revalidate: 60 * 60 * 24 },
  });

  const json = await response.json();
  return {
    media: json.data.Page.media,
    pageInfo: json.data.Page.pageInfo as {
      currentPage: number;
      hasNextPage: boolean;
    },
  };
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

  const response =
    await fetch(
      "https://graphql.anilist.co",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify(
          {
            query,
            variables: {
              id,
            },
      }),
})
      
    

  const json =
    await response.json();

  return json.data.Media;
}