export const sep = '/'
export function join(...p: string[]): string { return p.filter(Boolean).join('/').replace(/\/+/g, '/') }
export function relative(from: string, to: string): string { return to.startsWith(from) ? to.slice(from.length + 1) : to }
export function dirname(p: string): string { return p.split('/').slice(0, -1).join('/') }
export function basename(p: string): string { return p.split('/').pop() ?? '' }
export function resolve(...p: string[]): string { return join(...p) }
export function isAbsolute(p: string): boolean { return p.startsWith('/') }
export default { sep, join, relative, dirname, basename, resolve, isAbsolute }
