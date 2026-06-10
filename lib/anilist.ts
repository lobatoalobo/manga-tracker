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

/** Listado A-Z de mangas, paginado (10 por página). */
export async function getMangaPage(page: number, includeAdult = true) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 10) {
        pageInfo { currentPage hasNextPage }
        media(type: MANGA, sort: TITLE_ROMAJI${includeAdult ? "" : ", isAdult: false"}) {
          id
          title { romaji english native }
          coverImage { large }
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