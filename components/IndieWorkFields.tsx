const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

export default function IndieWorkFields() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input name="title" required placeholder="Título *" className={input} />
        <input name="author" required placeholder="Autor/a *" className={input} />
      </div>
      <textarea
        name="synopsis"
        placeholder="Sinopsis / de qué trata"
        rows={3}
        className={input}
      />
      <input
        name="coverUrl"
        placeholder="URL de la portada (https://…)"
        className={input}
      />
      <input
        name="buyUrl"
        placeholder="Link para comprar / leer (https://…)"
        className={input}
      />
      <input
        name="social"
        placeholder="Redes del autor (@usuario o URL)"
        className={input}
      />
    </div>
  );
}
