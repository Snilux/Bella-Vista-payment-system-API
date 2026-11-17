// A-02: the user name proposed for a new account, "nombre.apellido" (Figma: "ana.torres"),
// lowercase and without accents so it passes usernameSchema (3 to 32 of a-z, 0-9, ".", "_",
// "-"). The API only gives the full name, so the paternal surname is guessed: the second word
// of two, otherwise the second to last (names usually end with both surnames). It is only a
// proposal: the superadmin can change it, and the API answers USERNAME_TAKEN if it exists.

const MAX_LENGTH = 32;

function plain(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** "María José López Hernández" → "maria.lopez"; null when nothing usable is left. */
export function suggestUsername(fullName: string): string | null {
  const words = fullName.trim().split(/\s+/).map(plain).filter(Boolean);
  const first = words[0];
  if (!first) return null;
  const surname = words.length >= 3 ? words[words.length - 2] : words[1];
  const suggestion = (surname ? `${first}.${surname}` : first).slice(0, MAX_LENGTH);
  return suggestion.length >= 3 ? suggestion : null;
}
