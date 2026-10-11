/** Human label for computed-fact references (score, gap, components). */
function refLabel(id: string): string {
  if (id.startsWith("comp:")) return id.slice(5).replaceAll("_", " ");
  if (id.startsWith("gap:")) return "data gap";
  if (id.startsWith("pivot:")) return "pivot rule";
  return id;
}

/** Renders narrative text with [ev:ID] markers as small evidence links. */
export function NarrativeText({ text, labels }: { text: string; labels: Map<string, string> }) {
  // Key each fragment by its character offset, which is stable for a given text.
  let offset = 0;
  // Trim the space before each marker so the chip sits on the preceding word.
  const parts = text
    .replace(/\s+(\[ev:)/g, "$1")
    .split(/(\[ev:[^\]]+\])/g)
    .map((p) => {
      const at = offset;
      offset += p.length;
      return { p, at };
    });
  return (
    <p>
      {parts.map(({ p, at }) => {
        const m = p.match(/^\[ev:([^\]]+)\]$/);
        if (!m) return p;
        const id = m[1];
        const label = labels.get(id) ?? refLabel(id);
        return (
          <a
            key={at}
            href={labels.has(id) ? `#ev-${id}` : undefined}
            title={label}
            className="ml-1 whitespace-nowrap rounded-md bg-sand-2 px-1.5 py-0.5 align-baseline text-xs font-bold text-ink no-underline"
          >
            {labels.has(id) ? "evidence" : label}
          </a>
        );
      })}
    </p>
  );
}
