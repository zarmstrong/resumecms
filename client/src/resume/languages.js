// A languages block (issue #217): one list of languages, each with an
// optional level written as the person likes (Native, Fluent, B2...).
// LEVEL_SUGGESTIONS only feed the editor's suggestions; any text is kept.
export const LEVEL_SUGGESTIONS = ['Native', 'Fluent', 'Professional', 'Conversational', 'Basic'];

// The entries a resume shows: those with a language, trimmed, in order.
export function shownLanguages(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return entries
    .filter((entry) => entry && typeof entry.language === 'string' && entry.language.trim())
    .map((entry) => ({ language: entry.language.trim(), level: typeof entry.level === 'string' ? entry.level.trim() : '' }));
}
