import {
  addToCollection,
  getCollection,
} from "@/lib/collection";

import {
  toggleVolume,
} from "@/lib/collection";

export async function GET() {
  return Response.json(
    getCollection()
  );
}

export async function POST(
  req: Request
) {
  const body =
    await req.json();

  addToCollection(body);

  return Response.json({
    success: true,
  });
}

export async function PATCH(
  req: Request
) {
  const body =
    await req.json();

  toggleVolume(
    body.mangaId,
    body.volume
  );

  return Response.json({
    success: true,
  });
}