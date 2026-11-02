// When each saved message was written, by its id (UTC ms). Claude's SDK message list leaves the time out, but every
// line of a Claude transcript file carries it as a UTC timestamp, so the times are read from the file's text here.
export function transcriptTimes(text) {
  const times = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"timestamp"')) continue;
    try {
      const o = JSON.parse(line);
      const at = Date.parse(o.timestamp);
      if (o.uuid && at) times.set(o.uuid, at);
    } catch { /* a line that is not JSON is skipped */ }
  }
  return times;
}
