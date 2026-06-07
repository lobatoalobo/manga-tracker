"use client";

export default function AddButton({
  manga,
}: {
  manga: any;
}) {
  async function add() {
    await fetch(
      "/api/collection",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(
          manga
        ),
      }
    );

    alert(
      "Agregado a la colección"
    );
  }

  return (
    <button
      onClick={add}
      style={{
        padding: 10,
        marginTop: 20,
      }}
    >
      Agregar a mi colección
    </button>
  );
}