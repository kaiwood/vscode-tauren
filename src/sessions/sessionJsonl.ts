export function parseSessionJsonlRecords(content: string): unknown[] {
  const records: unknown[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed session lines. Pi session readers are intentionally tolerant.
    }
  }

  return records;
}
