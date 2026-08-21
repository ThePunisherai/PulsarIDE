/* ThePunisher :: LD_PRELOAD anti-anti-debug shim (Linux)
 *
 * Defeats the classic self-ptrace anti-debugging trick: a target calls
 * ptrace(PTRACE_TRACEME, 0, 0, 0) on itself, and if a real debugger is already attached
 * the real syscall fails (a process can only have one tracer), which the target reads as
 * "I'm being debugged." This shim makes that ONE specific request always report success
 * without touching real ptrace state, so gdb can attach and step through a target that
 * tries this check -- every other ptrace request (PEEKTEXT, POKETEXT, CONT, SINGLESTEP,
 * GETREGS, ...) is passed straight through to the real libc ptrace() unmodified. This
 * does not defeat /proc/self/status TracerPid checks or timing-based (rdtsc) detection --
 * those need separate techniques, same honesty convention as this repo's other RE-tooling
 * docs (e.g. x64dbg has no headless mode -- a real limitation, not silently glossed over).
 *
 * Build: gcc -shared -fPIC -o ptrace_hide.so ptrace_hide.c -ldl
 * Use:   LD_PRELOAD=./ptrace_hide.so gdb -q --batch ... ./target
 *        (wired automatically by ../linux-unpack.sh)
 *
 * Ethics: authorized security research, CTF, and interoperability testing only -- see
 * ../x64dbg-setup.md's "Ethics & scope" for the same guardrail this whole directory uses.
 */
#define _GNU_SOURCE
#include <sys/ptrace.h>
#include <sys/types.h>
#include <stdarg.h>
#include <dlfcn.h>
#include <stddef.h>

typedef long (*ptrace_fn)(enum __ptrace_request, pid_t, void *, void *);

long ptrace(enum __ptrace_request request, ...) {
    if (request == PTRACE_TRACEME) {
        return 0; /* fake success -- defeats the self-ptrace anti-debug check */
    }

    va_list ap;
    va_start(ap, request);
    pid_t pid = va_arg(ap, pid_t);
    void *addr = va_arg(ap, void *);
    void *data = va_arg(ap, void *);
    va_end(ap);

    static ptrace_fn real_ptrace = NULL;
    if (!real_ptrace) {
        real_ptrace = (ptrace_fn)dlsym(RTLD_NEXT, "ptrace");
    }
    return real_ptrace(request, pid, addr, data);
}
