// ThePunisher :: Frida dynamic-tracing agent
// Hooks common syscalls/APIs and logs calls with light argument decoding.
//
// Usage:
//   frida -l frida_trace.js -f ./target_binary --no-pause     # spawn
//   frida -l frida_trace.js -n target_binary                  # attach by name
//   frida -l frida_trace.js -p <pid>                          # attach by pid
//
// Works on Linux/macOS/Android/Windows targets (adjust the export list per OS).

'use strict';

// (module, export) pairs to trace. Missing exports are skipped silently.
const TARGETS = [
  // libc / POSIX
  [null, 'open'], [null, 'openat'], [null, 'read'], [null, 'write'],
  [null, 'connect'], [null, 'send'], [null, 'recv'],
  [null, 'system'], [null, 'execve'], [null, 'fork'],
  [null, 'dlopen'], [null, 'ptrace'],
  // crypto-ish (OpenSSL if present)
  ['libcrypto', 'EVP_DecryptUpdate'], ['libcrypto', 'EVP_EncryptUpdate'],
  // Windows (no-ops elsewhere)
  ['kernel32.dll', 'CreateFileW'], ['kernel32.dll', 'WriteFile'],
  ['ws2_32.dll', 'connect'], ['advapi32.dll', 'CryptDecrypt'],
];

function short(ptr, n) {
  try { return Memory.readUtf8String(ptr, n || 64); } catch (e) { return null; }
}

function resolve(mod, sym) {
  try {
    return mod ? Module.getExportByName(mod, sym) : Module.getExportByName(null, sym);
  } catch (e) { return null; }
}

let hooked = 0;
TARGETS.forEach(function (t) {
  const addr = resolve(t[0], t[1]);
  if (!addr) return;
  const label = (t[0] ? t[0] + '!' : '') + t[1];
  Interceptor.attach(addr, {
    onEnter: function (args) {
      this.label = label;
      // Best-effort: show first arg as string if it looks like one.
      const s = short(args[0]);
      this.hint = s ? (' arg0="' + s + '"') : '';
    },
    onLeave: function (retval) {
      send({ tag: 'call', fn: this.label, ret: retval.toInt32(), hint: this.hint });
    },
  });
  hooked++;
});

send({ tag: 'ready', hooked: hooked, pid: Process.id, arch: Process.arch, platform: Process.platform });
console.log('[ThePunisher] frida agent armed: ' + hooked + ' hooks on pid ' + Process.id);
