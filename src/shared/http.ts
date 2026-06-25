export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function appendQuery(path: string, params: Record<string, unknown>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, String(item));
      }
      continue;
    }

    query.set(key, String(value));
  }

  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}
