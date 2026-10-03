/** BR-22: show display_name; fall back to the handle when it is blank. */
export function displayName(member: { display_name: string; handle: string }): string {
  const name = member.display_name.trim();
  return name.length > 0 ? name : member.handle;
}
