/** Decode the provider's real SSE frames, including split UTF-8 characters. */
export async function* responseEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = '', data: string[] = [], bytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 160_000) throw new Error('Risposta troppo grande.');
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        else if (!line && data.length) {
          const payload = data.join('\n'); data = [];
          if (payload !== '[DONE]') yield JSON.parse(payload) as Record<string, unknown>;
        }
      }
    }
    // An incomplete SSE frame is never accepted as a completed response.
    if (buffer.trim() || data.length) throw new Error('Flusso interrotto.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Only complete JSON claim objects can be checked and shown during generation. */
export function completeClaims(json: string): unknown[] {
  const start = /"claims"\s*:\s*\[/.exec(json);
  if (!start) return [];
  const result: unknown[] = [];
  let quoted = false, escaped = false, depth = 0, objectStart = -1;
  for (let index = start.index + start[0].length; index < json.length; index++) {
    const char = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (!depth) objectStart = index; depth++; }
    else if (char === '}') {
      depth--;
      if (!depth && objectStart >= 0) {
        result.push(JSON.parse(json.slice(objectStart, index + 1))); objectStart = -1;
      }
    } else if (char === ']' && !depth) break;
  }
  return result;
}
