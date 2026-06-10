const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

export default function StoreFields() {
  return (
    <div className="space-y-2">
      <input name="name" required placeholder="Nombre *" className={input} />
      <div className="grid grid-cols-2 gap-2">
        <input name="province" placeholder="Provincia" className={input} />
        <input name="city" placeholder="Ciudad / Barrio" className={input} />
      </div>
      <input name="address" placeholder="Dirección" className={input} />
      <div className="grid grid-cols-2 gap-2">
        <input name="phone" placeholder="Teléfono" className={input} />
        <input name="hours" placeholder="Horario" className={input} />
      </div>
      <input name="website" placeholder="Sitio web (https://…)" className={input} />
      <input name="social" placeholder="Red social (@usuario o URL)" className={input} />
    </div>
  );
}
