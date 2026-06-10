import { signIn, signOut } from "@/auth";

export function SignIn({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/collection" });
      }}
    >
      <button
        className={
          className ??
          "rounded-lg bg-accent px-5 py-2.5 font-medium text-white transition hover:opacity-90"
        }
      >
        Entrar con Google
      </button>
    </form>
  );
}

export function SignOut() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button className="text-sm text-muted transition hover:text-foreground">
        Salir
      </button>
    </form>
  );
}
