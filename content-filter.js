const normalizeText = (value) => {
  const raw = String(value || "").toLowerCase();
  const noDiacritics = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const spaced = noDiacritics.replace(/\s+/g, " ").trim();
  const compact = noDiacritics.replace(/[^a-z0-9]+/g, "");
  return { spaced, compact };
};

const BANNED_PHRASES = [
  "zabij sie",
  "idz sie zabic",
  "powies sie",
  "skocz z mostu",
  "skocz pod pociag",
  "podetnij se zyly",
  "podetnij sobie zyly",
  "zastrzel sie",
  "udus sie",
  "zdychaj",
  "zdechnij",
  "odwal sie",
  "zamknij morde",
  "zamknij ryj",
];

const BANNED_TERMS = [
  "chuj",
  "chuju",
  "chujem",
  "chujnia",
  "ciota",
  "cwel",
  "debil",
  "dojebe",
  "dziwka",
  "dziwko",
  "gowno",
  "jebac",
  "jebaj",
  "jebana",
  "jebanego",
  "jebany",
  "kurwa",
  "kurwo",
  "kurwie",
  "kurwiszcze",
  "kurwiszon",
  "matkojebca",
  "pedal",
  "pedale",
  "pizda",
  "pizdus",
  "pizdec",
  "pierdole",
  "pierdolic",
  "pierdolony",
  "pierdolnij",
  "pizdzie",
  "pizdeczka",
  "popierdolony",
  "skurwiel",
  "skurwielu",
  "skurwysyn",
  "skurwysynie",
  "suka",
  "suko",
  "sukinsyn",
  "szmata",
  "szmato",
  "wypierdalaj",
  "wypierdalac",
  "wykurwiac",
  "wykurwiaj",
  "zakurwiac",
  "zapierdalac",
  "zapierdol",
  "zjeb",
  "zjebie",
  "zjebany",
  "zjebana",
  "zjebani",
  "spierdalaj",
  "baran",
  "idiota",
  "kretyn",
  "polglowek",
  "przyglup",
  "tepak",
  "osiol",
  "pajac",
  "frajer",
  "lamus",
  "swir",
  "pojeb",
  "pojebany",
  "popapraniec",
  "scierwo",
  "gnoj",
  "gnojek",
  "padalec",
  "lachudra",
  "menel",
  "nierob",
  "darmozjad",
  "patalach",
  "nieudacznik",
  "mudzin",
  "nigger",
];

const uniqueSorted = (arr) => Array.from(new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))).sort();
const PHRASES = uniqueSorted(BANNED_PHRASES);
const TERMS = uniqueSorted(BANNED_TERMS);

const containsWholeWord = (haystack, term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(haystack);
};

export const checkTextAllowed = (text) => {
  const { spaced, compact } = normalizeText(text);
  if (!spaced && !compact) return { allowed: true, reason: "" };

  for (const phrase of PHRASES) {
    if (!phrase) continue;
    const phraseCompact = phrase.replace(/\s+/g, "");
    if (spaced.includes(phrase) || (phraseCompact && compact.includes(phraseCompact))) {
      return { allowed: false, reason: phrase };
    }
  }

  for (const term of TERMS) {
    if (!term) continue;
    if (containsWholeWord(spaced, term) || (term.length >= 4 && compact.includes(term))) {
      return { allowed: false, reason: term };
    }
  }

  return { allowed: true, reason: "" };
};
