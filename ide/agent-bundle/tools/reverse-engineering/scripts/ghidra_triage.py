# ThePunisher :: Ghidra headless triage post-script (Jython 2.7 / Ghidra API)
# Runs during headless analysis and prints a compact triage report.
#
# Usage (from tools/reverse-engineering/):
#   analyzeHeadless /tmp/ghproj Triage -import ./target.bin \
#       -postScript ghidra_triage.py -scriptPath ./scripts -deleteProject
#
# Only Ghidra "flat API" globals/classes are used (currentProgram, monitor).
# @category ThePunisher

import json

def _entry_point(prog):
    st = prog.getSymbolTable()
    for name in ("entry", "_start", "main", "start"):
        it = st.getSymbols(name)
        if it.hasNext():
            return name, it.next().getAddress().toString()
    ep = prog.getImageBase()
    return "image_base", ep.toString() if ep else "?"

def main():
    prog = currentProgram  # noqa: F821  (Ghidra global)
    listing = prog.getListing()
    fm = prog.getFunctionManager()

    functions = []
    fn = fm.getFunctions(True)
    for f in fn:
        functions.append({
            "name": f.getName(),
            "addr": f.getEntryPoint().toString(),
            "size": f.getBody().getNumAddresses(),
        })

    # External / imported symbols
    imports = []
    ext = prog.getExternalManager()
    for lib in ext.getExternalLibraryNames():
        loc = ext.getExternalLocations(lib)
        while loc.hasNext():
            imports.append({"lib": lib, "sym": loc.next().getLabel()})

    ep_name, ep_addr = _entry_point(prog)

    report = {
        "program": prog.getName(),
        "format": prog.getExecutableFormat(),
        "language": str(prog.getLanguageID()),
        "compiler": str(prog.getCompilerSpec().getCompilerSpecID()),
        "image_base": prog.getImageBase().toString(),
        "entry": {"symbol": ep_name, "addr": ep_addr},
        "function_count": len(functions),
        "import_count": len(imports),
        # keep the report compact -- it goes into an agent context
        "functions_sample": functions[:40],
        "imports_sample": imports[:60],
    }

    print("[ThePunisher] === Ghidra triage ===")
    print(json.dumps(report, indent=2))
    print("[ThePunisher] === end triage (%d funcs, %d imports) ==="
          % (len(functions), len(imports)))

main()
