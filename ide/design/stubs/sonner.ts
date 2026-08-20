type Fn = (m: string) => void
export const toast: Fn & { success: Fn; error: Fn; info: Fn } = Object.assign(
  ((m: string) => console.log('[toast]', m)) as Fn,
  { success: (m: string) => console.log('[toast ok]', m),
    error: (m: string) => console.log('[toast err]', m),
    info: (m: string) => console.log('[toast]', m) }
)
