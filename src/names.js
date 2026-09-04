// Name normalisation used to merge the same reciter across sources.
// Each name becomes a set of "phonetic" tokens so that transliteration variants
// (Hussary/Husary, Muaiqly/Meaqli, Dosari/Dussary, Mohammed/Muhammad …) collide.
const PARTICLES = new Set(["al","el","ar","as","ash","ad","at","an","bin","ibn","abu","abo","sheikh","shaikh","shaik","dr","the","and","from","ustaz","qari","qaria","rashid","rasheed","rachid"]);

function foldToken(t) {
  t = t.replace(/^abd(ul|ur|el|al|u|a|e|ol)?/, "abd");
  if (t.length > 4) t = t.replace(/^(al|el|ar|as|ash|ad|at|an)(?=[a-z]{3})/, "");
  t = t.replace(/ph/g, "f").replace(/th|dh/g, "t").replace(/kh/g, "k").replace(/gh/g, "g")
       .replace(/sh/g, "s").replace(/ck|q|c/g, "k").replace(/z/g, "s").replace(/w/g, "u").replace(/y/g, "i");
  t = t[0] + t.slice(1).replace(/[aeiou]/g, "");
  t = t.replace(/(.)\1+/g, "$1").replace(/h$/, "");
  return t;
}

export function nameTokens(name) {
  const words = name.toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[`'’ʿʾ]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/).filter((w) => w && !PARTICLES.has(w));
  for (let i = 0; i < words.length - 1; i++) {
    if (/^abd(ul|ur|el|al|u|a|e)?$/.test(words[i])) words.splice(i, 2, words[i] + words[i + 1]);
  }
  return new Set(words.map(foldToken).filter((t) => t.length > 1));
}

export function normalizeName(name) { return [...nameTokens(name)].sort().join(" "); }

export function sameReciter(a, b) {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 2 && big.size !== small.size) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}
