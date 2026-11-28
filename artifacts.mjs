// Which file a session's Artifact tool call published, and to which page: kept apart from the server so it can be tested.

// An artifact page's link, in either form claude.ai gives it: claude.ai/artifact/<id> or claude.ai/code/artifact/<uuid>.
export const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/;

// { path, url } when an Artifact call published a page from one file and the tool said so, else null.
// A refused publish (not viewed the live version, a conflict) is an error or does not start "Published", and an
// asset upload puts a file in a page's store rather than making it the page. The url is the one the result names,
// else the one the call was sent to.
export function artifactPublished(input, result, error) {
  const inp = input || {};
  if ((inp.action || 'publish') !== 'publish' || inp.asset || inp.type_url || !inp.file_path) return null;
  const text = String(result || '');
  if (error || !/^Published\b/.test(text)) return null;
  const url = text.match(ARTIFACT_URL)?.[0] || (ARTIFACT_URL.test(inp.url || '') ? inp.url : '');
  return url ? { path: inp.file_path, url } : null;
}
