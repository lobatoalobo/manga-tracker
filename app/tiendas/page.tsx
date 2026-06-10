import { auth } from "@/auth";
import { getApprovedStores } from "@/lib/stores";
import StoreList from "@/components/StoreList";
import ProposeStore from "@/components/ProposeStore";

export const metadata = {
  title: "Tiendas · Manga Tracker",
};

export default async function TiendasPage() {
  const session = await auth();
  const stores = await getApprovedStores();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Tiendas / Comiquerías</h1>
      <p className="mb-6 text-sm text-muted">
        Dónde conseguir manga en Argentina.
      </p>

      <StoreList stores={stores} />

      {session && <ProposeStore />}
    </main>
  );
}
