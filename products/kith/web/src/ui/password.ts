const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆字元

export function generatePassword(length = 16): string {
  const values = crypto.getRandomValues(new Uint32Array(length));
  let out = "";
  for (const v of values) out += ALPHABET[v % ALPHABET.length];
  return out;
}
