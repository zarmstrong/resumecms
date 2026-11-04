// The download name for a resume's PDF, from the published header's name:
// "Ada Lovelace" -> "Resume-of-Ada-Lovelace.pdf". Only ASCII letters and
// digits survive (it goes into a quoted Content-Disposition filename), so a
// name with none of those, or one that isn't a string at all (the header
// isn't type-checked), falls back to "Resume" rather than producing
// "Resume-of-.pdf" or throwing.
export function pdfFileName(name) {
  const slug = typeof name === 'string' ? name.replace(/[^a-z0-9]+/gi, ' ').trim().replace(/\s+/g, '-') : '';
  return `Resume-of-${slug || 'Resume'}.pdf`;
}
