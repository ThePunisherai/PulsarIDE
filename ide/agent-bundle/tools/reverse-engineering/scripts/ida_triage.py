# ThePunisher :: IDA Pro headless/batch triage script (IDAPython)
# Prints a compact triage report, same shape/purpose as ghidra_triage.py, for the case where
# Ghidra isn't available but a real IDA Pro license is (verified: works on IDA Pro 8.3+ via the
# classic idat64 batch mechanism -- NOT the newer `idalib` headless library, which Hex-Rays' own
# docs (docs.hex-rays.com/core/idalib/getting-started) confirm requires IDA Pro 9.0+ and does not
# support 8.3).
#
# Usage (from tools/reverse-engineering/), any modern IDA Pro including 8.3:
#   idat64 -A -S"scripts/ida_triage.py" ./target.bin
#
# -A  = autonomous/batch mode: no dialog boxes, no waiting on user input
# -S  = run this script once the database is opened
# Both flags are documented, version-stable IDA command-line switches
# (docs.hex-rays.com/core/user-interface/concepts/command-line-switches) -- unlike idalib, this
# mechanism is not gated to a specific IDA version. Not available in the IDA Home edition per the
# same docs.
#
# API notes (confidence, not guessed): idautils.Functions(), idc.get_func_name(),
# idc.get_inf_attr(idc.INF_START_IP), and ida_nalt's import-enumeration callback are long-stable,
# widely-documented core IDAPython APIs unchanged across IDA 7.x-9.x -- this session verified the
# 8.3-vs-9.0 idalib distinction and the -A/-S switches directly against official Hex-Rays docs,
# but did not have a live IDA 8.3 instance available to execute this exact script end-to-end.
# Treat as verified-against-stable-API, not live-tested, until run once against a real IDA 8.3.
# @category ThePunisher

import json

import ida_nalt
import ida_pro
import idautils
import idc


def _entry_point():
    ep = idc.get_inf_attr(idc.INF_START_IP)
    if ep and ep != idc.BADADDR:
        name = idc.get_func_name(ep) or idc.get_name(ep) or "?"
        return name, "0x%x" % ep
    base = idc.get_inf_attr(idc.INF_MIN_EA)
    return "image_base", "0x%x" % base


def _imports():
    imports = []

    def _collect(module_name):
        def cb(ea, imp_name, ordinal):
            imports.append({
                "lib": module_name,
                "sym": imp_name or ("ord_%d" % ordinal),
                "addr": "0x%x" % ea,
            })
            return True
        return cb

    for i in range(ida_nalt.get_import_module_qty()):
        module_name = ida_nalt.get_import_module_name(i) or "?"
        ida_nalt.enum_import_names(i, _collect(module_name))
    return imports


def main():
    # Block until IDA's own auto-analysis queue is empty -- without this, -A/-S can run the
    # script before functions/imports are fully discovered, silently truncating the report.
    idc.auto_wait()

    functions = []
    for ea in idautils.Functions():
        functions.append({
            "name": idc.get_func_name(ea),
            "addr": "0x%x" % ea,
            "size": idc.get_func_attr(ea, idc.FUNCATTR_END) - ea,
        })

    imports = _imports()
    ep_name, ep_addr = _entry_point()

    report = {
        "program": idc.get_root_filename(),
        "format": idc.get_file_type_name(),
        "image_base": "0x%x" % idc.get_inf_attr(idc.INF_MIN_EA),
        "entry": {"symbol": ep_name, "addr": ep_addr},
        "function_count": len(functions),
        "import_count": len(imports),
        # keep the report compact -- it goes into an agent context
        "functions_sample": functions[:40],
        "imports_sample": imports[:60],
    }

    print("[ThePunisher] === IDA Pro triage ===")
    print(json.dumps(report, indent=2))
    print("[ThePunisher] === end triage (%d funcs, %d imports) ==="
          % (len(functions), len(imports)))

    ida_pro.qexit(0)


main()
