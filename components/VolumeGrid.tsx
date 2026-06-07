"use client";

import { useRouter } from "next/navigation";

export default function VolumeGrid({
  mangaId,
  totalVolumes,
  ownedVolumes,
  wishlistVolumes,
}: {
  mangaId: number;
  totalVolumes: number;
  ownedVolumes: number[];
  wishlistVolumes: number[];
}) {
  const router = useRouter();

  async function toggle(volume: number) {
    await fetch("/api/collection", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mangaId,
        volume,
      }),
    });

    router.refresh();
  }

  const volumes = [];

  for (let i = 1; i <= totalVolumes; i++) {
    const owned = ownedVolumes.includes(i);

    const wished = wishlistVolumes.includes(i);

    volumes.push(
      <button
        key={i}
        onClick={() => toggle(i)}
        style={{
          width: 60,
          height: 60,
          cursor: "pointer",
          fontWeight: "bold",
          backgroundColor: owned ? "#90EE90" : wished ? "#FFE066" : "#FFFFFF",
          border: "1px solid black",
        }}
      >
        {i}
      </button>,
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 60px)",
        gap: "10px",
      }}
    >
      {volumes}
    </div>
  );
}
