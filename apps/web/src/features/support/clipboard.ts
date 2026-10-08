/**
 * Write text to the clipboard. Resolves true only when the browser confirms the write; false means
 * the caller must show the manual-copy fallback (spec 6). Never throws.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
