/** 22 characters, within the server's 8–64 limit. */
export function newClientMessageId(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 20; i++) s += "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 36)];
  return "c-" + s;
}
