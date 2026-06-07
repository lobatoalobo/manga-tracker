const query = `
query {
  Media(search: "One Piece", type: MANGA) {
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

export async function getOnePiece() {
  const response = await fetch(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
      }),
    }
  );

  const json = await response.json();

  return json.data.Media;
}