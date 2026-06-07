"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBar() {
  const router = useRouter();

  const [search, setSearch] = useState("");

  function handleSubmit(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!search.trim()) return;

    router.push(
      `/?search=${encodeURIComponent(search)}`
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={search}
        onChange={(e) =>
          setSearch(e.target.value)
        }
        placeholder="Buscar manga..."
        style={{
          padding: "10px",
          width: "300px",
          marginRight: "10px",
        }}
      />

      <button
        type="submit"
        style={{
          padding: "10px 20px",
        }}
      >
        Buscar
      </button>
    </form>
  );
}