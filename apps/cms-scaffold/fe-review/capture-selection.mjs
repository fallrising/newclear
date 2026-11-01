/** Select an explicit repaired subset without rewriting either original manifest. */
export function selectRecords(original, repair, expectedKeys, replacementKeys) {
  const expected = new Set(expectedKeys);
  const replacements = new Set(replacementKeys);
  if (expected.size !== expectedKeys.length || replacements.size !== replacementKeys.length) throw new Error('REVIEW_KEYS');
  function index(records, keys) {
    const map = new Map();
    for (const record of records) {
      if (!keys.has(record.key) || map.has(record.key)) throw new Error('REVIEW_DUPLICATE_OR_UNEXPECTED');
      map.set(record.key, record);
    }
    if (map.size !== keys.size) throw new Error('REVIEW_MISSING');
    return map;
  }
  for (const key of replacements) if (!expected.has(key)) throw new Error('REVIEW_REPLACEMENT');
  const old = index(original, expected);
  const fresh = index(repair, replacements);
  return expectedKeys.map((key) => {
    const previous = old.get(key);
    if (replacements.has(key)) {
      if (!previous.value.error) throw new Error('REVIEW_REPLACE_GREEN');
      const next = fresh.get(key);
      if (next.value.error) throw new Error('REVIEW_REPAIR_FAILED');
      return { ...next, attempt: 'repair' };
    }
    if (previous.value.error) throw new Error('REVIEW_UNREPAIRED');
    return { ...previous, attempt: 'original' };
  });
}
