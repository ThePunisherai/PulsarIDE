import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
// Byte-for-byte what Orca's own src/renderer/src/lib/utils.ts does.
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)) }
