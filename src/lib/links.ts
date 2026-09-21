export function fileHref(owner: string, repo: string, number: number, path: string) {
  return `/${owner}/${repo}/pull/${number}/file/${path.split("/").map(encodeURIComponent).join("/")}`;
}
