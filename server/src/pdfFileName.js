// The download name for a resume's PDF, from the published header's name:
// "Ada Lovelace" -> "Resume-of-Ada-Lovelace.pdf". Only ASCII letters and
// digits survive (it goes into a quoted Content-Disposition filename), so a
// name with none of those, or one that isn't a string at all (the header
// isn't type-checked), falls back to "Resume" rather than producing
// "Resume-of-.pdf" or throwing.
export function pdfFileName(name) {
  return `Resume-of-${dashed(name) || 'Resume'}.pdf`;
}

// The same for a cover letter (issue #71), from the name it's signed with,
// plus the company it's for when there is one, so letters for two
// applications don't download under one name:
// "Cover-Letter-of-Ada-Lovelace-for-Acme.pdf".
export function letterPdfFileName(name, company) {
  const forCompany = dashed(company);
  return `Cover-Letter-of-${dashed(name) || 'Applicant'}${forCompany ? `-for-${forCompany}` : ''}.pdf`;
}

function dashed(text) {
  return typeof text === 'string' ? text.replace(/[^a-z0-9]+/gi, ' ').trim().replace(/\s+/g, '-') : '';
}
