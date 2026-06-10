export function cleanDescription(
  text: string,
) {
  if (!text) {
    return "";
  }

  return text
    .replace(
      /<br\s*\/?>/gi,
      "\n",
    )
    .replace(
      /<\/?i>/gi,
      "",
    )
    .replace(
      /<\/?b>/gi,
      "",
    )
    .replace(
      /<[^>]+>/g,
      "",
    )
    .replace(
      /\n{3,}/g,
      "\n\n",
    )
    .trim();
}