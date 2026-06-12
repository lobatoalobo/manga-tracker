import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  trustHost: true, // necesario en Vercel
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    // Log de inicios de sesión para el panel admin.
    async signIn({ user }) {
      try {
        await prisma.loginEvent.create({
          data: {
            userId: user.id ?? null,
            name: user.name ?? null,
            email: user.email ?? null,
            image: user.image ?? null,
          },
        });
      } catch {
        /* best-effort: no romper el login si falla el log */
      }
    },
  },
});

/** Devuelve el id del usuario logueado o lanza si no hay sesión. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("No autenticado");
  return session.user.id;
}
