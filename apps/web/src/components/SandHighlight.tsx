/** `text` with `highlight` (when present inside it) wrapped in the sand underline. */
export function SandHighlight({ text, highlight }: { text: string; highlight?: string }) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (at < 0 || !highlight) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="sand-underline">{highlight}</span>
      {text.slice(at + highlight.length)}
    </>
  );
}
