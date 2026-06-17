// Talks to the backend /api/solve and provides a local, safe arithmetic
// evaluator used when the user corrects a misread digit.

export async function solveImage(dataUrl) {
  return post({ image: dataUrl });
}

// x'li denklem ya da düzeltilmiş ifadeyi metin olarak sunucuda çözer.
export async function solveText(equation) {
  return post({ equation });
}

async function post(body) {
  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Sunucu hatası (${res.status})`);
  }
  return json; // { found, type, equation, answer }
}

/**
 * Safely evaluate a simple arithmetic expression for the correction box.
 * Accepts digits, + - * / ^ ( ) . , × ÷ and whitespace only.
 * Returns a string answer, or throws on invalid input.
 */
export function evaluateExpression(input) {
  let expr = String(input)
    .replace(/×/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/·/g, "*")
    .replace(/,/g, ".")
    .replace(/\^/g, "**")
    .replace(/=+\s*$/, "") // drop a trailing =
    .trim();

  if (!expr) throw new Error("Boş ifade");
  // Charset guard: digits, operators (+ - * /, ** for power), parens, dot, space.
  if (!/^[-+*/().\d\s]+$/.test(expr)) {
    throw new Error("Geçersiz karakter");
  }

  let value;
  try {
    // eslint-disable-next-line no-new-func
    value = Function('"use strict"; return (' + expr + ");")();
  } catch {
    throw new Error("Hesaplanamadı");
  }
  if (typeof value !== "number" || !isFinite(value)) {
    throw new Error("Geçersiz sonuç");
  }
  // Round to at most 4 decimals, trim trailing zeros.
  return String(Math.round(value * 1e4) / 1e4);
}
