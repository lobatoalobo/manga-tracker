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
      }

      volumes

      status

      description
    }
  }
  `;

  const response = await fetch(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          search,
        },
      }),
    }
  );

  const json = await response.json();

  return json.data.Media;
}