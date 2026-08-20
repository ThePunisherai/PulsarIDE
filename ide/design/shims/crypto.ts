let n = 0
export function randomUUID(): string {
  n += 1
  return `0000${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
}
export function createHash(): { update: () => unknown; digest: () => string } {
  const api = { update: () => api, digest: () => 'deadbeefdeadbeef' }
  return api
}
export default { randomUUID, createHash }
