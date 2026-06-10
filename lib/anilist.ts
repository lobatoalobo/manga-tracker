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
) {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(
          search: $search,
          type: MANGA
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