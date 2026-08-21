# ThePunisher Growth Pools — opt-in team expansion

Generated from `agents/roster.json`'s `growth_agents` field by `scripts/generate-agents.py`. NOT deployed by default — opt a team in via `install.sh --grow-teams=<slug>,<slug>` / `Install.ps1 -GrowTeams <slug>,<slug>` / the install wizard's checkboxes.


## Team 1 — The Council (15 growth agents)

- `council/thepunisher-secondopiniondispatcher.md` — **ThePunisher-SecondOpinionDispatcher**: Delegates a genuine second opinion to another CLI/model via the dispatch skill when the Council's own confidence is low or the decision is architecturally significant.
- `council/thepunisher-claimconfidencescorer.md` — **ThePunisher-ClaimConfidenceScorer**: Attaches an explicit confidence level to each individual claim in an output -- distinct from Team 8's ConfidenceCalibrator, which tracks historical track-record accuracy over time rather than per-claim confidence.
- `council/thepunisher-premortemanalyst.md` — **ThePunisher-PreMortemAnalyst**: Runs a pre-mortem: assumes the plan already failed and works backward to find why -- distinct from RiskAssessor's forward-looking risk inventory.
- `council/thepunisher-blastradiusestimator.md` — **ThePunisher-BlastRadiusEstimator**: Estimates how far a change's effects could spread (files, services, users) before it ships -- a narrower SRE-style scope than RiskAssessor's broader risk categories.
- `council/thepunisher-evidenceweightassessor.md` — **ThePunisher-EvidenceWeightAssessor**: Weighs the strength/quality of evidence behind a claim (a single unverified comment vs. a reproduced test) -- distinct from Factchecker's binary true/false verification.
- `council/thepunisher-crosssessioncontinuitykeeper.md` — **ThePunisher-CrossSessionContinuityKeeper**: Bridges context across separate sessions on the same project via graphify/the Data folder -- distinct from SessionMemoryKeeper's single-session scope.
- `council/thepunisher-postmortemfacilitator.md` — **ThePunisher-PostMortemFacilitator**: Runs a structured retrospective after work completes -- successes included, not just failures -- distinct from Team 8's failure-only Lessons Learned.
- `council/thepunisher-instructionprecedenceresolver.md` — **ThePunisher-InstructionPrecedenceResolver**: Applies council.md's own conflict-resolution precedence order once InstructionConflictDetector has flagged a genuine conflict, rather than leaving it flagged with no resolution path.
- `council/thepunisher-minorityopinionpreserver.md` — **ThePunisher-MinorityOpinionPreserver**: Records the rejected position from a resolved disagreement explicitly rather than letting it disappear, per council.md's own conflict-resolution rule.
- `council/thepunisher-scopecreepdetector.md` — **ThePunisher-ScopeCreepDetector**: Watches for scope silently expanding during execution -- distinct from ScopeGuard, which sets the scope boundary up front.
- `council/thepunisher-silentfailurehunter.md` — **ThePunisher-SilentFailureHunter**: Looks specifically for operations that failed but were swallowed or ignored (an empty catch block, a non-zero exit code nobody checked) rather than loud, already-visible errors.
- `council/thepunisher-credibilityweightedsourceranker.md` — **ThePunisher-CredibilityWeightedSourceRanker**: Ranks the credibility of multiple sources against each other -- distinct from SourceCiter, which just attaches a citation.
- `council/thepunisher-reversibilityclassifier.md` — **ThePunisher-ReversibilityClassifier**: Classifies an in-flight EXECUTION action as a one-way door or a two-way door (Bezos framework) -- distinct from Brainstorm's ReversibilityChecker, which evaluates design decisions before anything is built.
- `council/thepunisher-dependencygraphvalidator.md` — **ThePunisher-DependencyGraphValidator**: Validates a task DAG for cycles or unresolved conflicts at the Council level -- distinct from Smart Task Management's DependencyMapper, which builds the graph in the first place.
- `council/thepunisher-consensusstrengthmeasurer.md` — **ThePunisher-ConsensusStrengthMeasurer**: Measures how strongly multiple agents/teams actually agree on a conclusion -- distinct from ConflictResolver, which only activates once they disagree.

## Team 2 — Brainstorm & Ideation (15 growth agents)

- `brainstorm/thepunisher-scamperfacilitator.md` — **ThePunisher-SCAMPERFacilitator**: Runs the SCAMPER framework (Substitute/Combine/Adapt/Modify/Put-to-other-use/Eliminate/Reverse) as a structured idea-generation checklist.
- `brainstorm/thepunisher-sixhatsthinkingfacilitator.md` — **ThePunisher-SixHatsThinkingFacilitator**: Runs De Bono's Six Thinking Hats to force explicit perspective-switching (facts, emotions, caution, benefits, creativity, process) during ideation.
- `brainstorm/thepunisher-trizinventiveprincipleexpert.md` — **ThePunisher-TRIZInventivePrincipleExpert**: Applies TRIZ's inventive principles to resolve technical contradictions instead of trading one requirement off against another.
- `brainstorm/thepunisher-designsprintfacilitator.md` — **ThePunisher-DesignSprintFacilitator**: Runs a compressed Google Ventures-style design-sprint structure (map, sketch, decide, prototype, test) for a scoped problem.
- `brainstorm/thepunisher-jobstobedoneanalyst.md` — **ThePunisher-JobsToBeDoneAnalyst**: Frames the problem as the job a user is 'hiring' the solution to do -- distinct from MarketResearcher's competitive lens and UserJourneyMapper's step-by-step flow.
- `brainstorm/thepunisher-blueoceanstrategist.md` — **ThePunisher-BlueOceanStrategist**: Looks for uncontested space via Blue Ocean Strategy's eliminate-reduce-raise-create grid instead of competing on the same axes as everyone else.
- `brainstorm/thepunisher-leancanvasbuilder.md` — **ThePunisher-LeanCanvasBuilder**: Sketches a one-page Lean Canvas (problem, solution, channels, revenue, cost) to pressure-test a concept before it's built out.
- `brainstorm/thepunisher-speculativefuturescenarioplanner.md` — **ThePunisher-SpeculativeFutureScenarioPlanner**: Builds multiple divergent future scenarios to stress-test a decision against -- distinct from LongTermVisionPlanner's single forward path.
- `brainstorm/thepunisher-biomimicryideator.md` — **ThePunisher-BiomimicryIdeator**: Looks to biological/natural systems for structural analogies to a design problem -- distinct from AnalogyFinder's broader cross-domain search.
- `brainstorm/thepunisher-constraintrelaxationexplorer.md` — **ThePunisher-ConstraintRelaxationExplorer**: Systematically relaxes one existing constraint at a time to see what becomes possible -- distinct from ConstraintMapper, which catalogs constraints rather than removing them.
- `brainstorm/thepunisher-moonshotideator.md` — **ThePunisher-MoonshotIdeator**: Pushes for 10x-bigger reframes of a problem instead of incremental 10% improvements.
- `brainstorm/thepunisher-painpointminer.md` — **ThePunisher-PainPointMiner**: Surfaces underlying user/business pain points from raw feedback or support data -- distinct from UXFrictionSpotter's narrower interface-level focus.
- `brainstorm/thepunisher-brainwritingfacilitator.md` — **ThePunisher-BrainwritingFacilitator**: Runs silent written brainstorming (6-3-5 method) to collect ideas without groupthink or the loudest-voice bias of live discussion.
- `brainstorm/thepunisher-wildcardscenarioinjector.md` — **ThePunisher-WildcardScenarioInjector**: Injects a deliberately unlikely, disruptive scenario mid-session to break anchoring on the first few ideas generated.
- `brainstorm/thepunisher-dotvotingfacilitator.md` — **ThePunisher-DotVotingFacilitator**: Runs dot-voting/multi-voting to converge a large idea set into a shortlist without a single decision-maker's bias dominating.

## Team 3 — Smart Task Management (10 growth agents)

- `task-management/thepunisher-productroadmapexpert.md` — **ThePunisher-ProductRoadmapExpert**: Quarter-spanning, dependency-aware roadmap planning and sequencing across teams.
- `task-management/thepunisher-prdwritingexpert.md` — **ThePunisher-PRDWritingExpert**: Product requirements documents: problem statement, success metrics, explicit scope boundaries.
- `task-management/thepunisher-userresearchsynthesisexpert.md` — **ThePunisher-UserResearchSynthesisExpert**: Synthesizing qualitative interviews/surveys into actionable, cited product insights.
- `task-management/thepunisher-prioritizationframeworkexpert.md` — **ThePunisher-PrioritizationFrameworkExpert**: RICE/MoSCoW/Kano-based feature prioritization with explicit, defensible scoring.
- `task-management/thepunisher-stakeholderalignmentexpert.md` — **ThePunisher-StakeholderAlignmentExpert**: Cross-functional alignment: decision docs, RACI matrices, disagree-and-commit records.
- `task-management/thepunisher-productanalyticsexpert.md` — **ThePunisher-ProductAnalyticsExpert**: Funnel/retention/cohort analysis to guide product decisions, distinct from infra observability.
- `task-management/thepunisher-gotomarketstrategyexpert.md` — **ThePunisher-GoToMarketStrategyExpert**: Launch planning, positioning, and cross-functional messaging coordination.
- `task-management/thepunisher-competitiveanalysisexpert.md` — **ThePunisher-CompetitiveAnalysisExpert**: Competitor feature/pricing/positioning analysis grounded in cited public sources.
- `task-management/thepunisher-productdiscoveryexpert.md` — **ThePunisher-ProductDiscoveryExpert**: Opportunity assessment and problem validation before committing to build.
- `task-management/thepunisher-okrplanningexpert.md` — **ThePunisher-OKRPlanningExpert**: Objectives-and-key-results design and cascading across a team hierarchy.

## Team 4 — Elite Coding Squad (82 growth agents)

- `coding/thepunisher-webassemblyapplicationdevelopmentexpert.md` — **ThePunisher-WebAssemblyApplicationDevelopmentExpert**: building WebAssembly applications (distinct from Team 5's WASM reverse-engineering focus).
- `coding/thepunisher-applicationlayerrustexpert.md` — **ThePunisher-ApplicationLayerRustExpert**: application-layer (non-embedded) Rust systems programming, distinct from Team 21's embedded-hal/no_std focus.
- `coding/thepunisher-gpucomputeshaderprogrammingexpert.md` — **ThePunisher-GPUComputeShaderProgrammingExpert**: GPU compute-shader/CUDA-style general-purpose GPU programming.
- `coding/thepunisher-lowlatencynetworkingcodeexpert.md` — **ThePunisher-LowLatencyNetworkingCodeExpert**: kernel-bypass/DPDK-style low-latency networking code.
- `coding/thepunisher-compilerconstructionexpert.md` — **ThePunisher-CompilerConstructionExpert**: building compilers/interpreters/transpilers.
- `coding/thepunisher-domainspecificlanguagedesignexpert.md` — **ThePunisher-DomainSpecificLanguageDesignExpert**: DSL design and parser construction.
- `coding/thepunisher-memorysafesystemsmigrationexpert.md` — **ThePunisher-MemorySafeSystemsMigrationExpert**: migrating C/C++ codebases to memory-safe languages.
- `coding/thepunisher-concurrencyprimitivesdesignexpert.md` — **ThePunisher-ConcurrencyPrimitivesDesignExpert**: designing custom concurrency primitives/lock-free data structures.
- `coding/thepunisher-codegenerationtoolingexpert.md` — **ThePunisher-CodeGenerationToolingExpert**: building code-generation tools/macros/templates.
- `coding/thepunisher-polyglotffibridgeexpert.md` — **ThePunisher-PolyglotFFIBridgeExpert**: foreign-function-interface bridging between languages.
- `coding/thepunisher-ocamlexpert.md` — **ThePunisher-OCamlExpert**: OCaml functional/systems programming.
- `coding/thepunisher-erlangexpert.md` — **ThePunisher-ErlangExpert**: Erlang/BEAM concurrent, fault-tolerant systems programming, distinct from Elixir's own syntax/tooling focus.
- `coding/thepunisher-nimexpert.md` — **ThePunisher-NimExpert**: Nim systems programming (Python-like syntax, C-level performance).
- `coding/thepunisher-crystalexpert.md` — **ThePunisher-CrystalExpert**: Crystal systems programming (Ruby-like syntax, compiled/statically typed).
- `coding/thepunisher-clojureexpert.md` — **ThePunisher-ClojureExpert**: Clojure (JVM Lisp) functional programming.
- `coding/thepunisher-fsharpexpert.md` — **ThePunisher-FSharpExpert**: F# functional-first .NET programming.
- `coding/thepunisher-prologexpert.md` — **ThePunisher-PrologExpert**: Prolog logic programming.
- `coding/thepunisher-adaexpert.md` — **ThePunisher-AdaExpert**: Ada safety-critical systems programming (aerospace/defense).
- `coding/thepunisher-posixshelllanguageinternalsexpert.md` — **ThePunisher-PosixShellLanguageInternalsExpert**: POSIX shell language internals and portability semantics (word-splitting, quoting rules, builtin behavior across dash/ash/bash), distinct from Team 12's own automation-scripting focus.
- `coding/thepunisher-dependencyresolutionalgorithmexpert.md` — **ThePunisher-DependencyResolutionAlgorithmExpert**: package-manager dependency-resolution algorithm engineering, distinct from PackageManagerExpert's CLI/registry-usage focus.
- `coding/thepunisher-vlangexpert.md` — **ThePunisher-VLangExpert**: V systems programming language.
- `coding/thepunisher-odinlanguageexpert.md` — **ThePunisher-OdinLanguageExpert**: Odin modern systems programming language.
- `coding/thepunisher-mojolanguageexpert.md` — **ThePunisher-MojoLanguageExpert**: Mojo AI-focused Python-superset systems language.
- `coding/thepunisher-gleamlanguageexpert.md` — **ThePunisher-GleamLanguageExpert**: Gleam typed functional language on the BEAM, distinct from Erlang/Elixir.
- `coding/thepunisher-elmlanguageexpert.md` — **ThePunisher-ElmLanguageExpert**: Elm functional language compiling to JS for frontends.
- `coding/thepunisher-rescriptexpert.md` — **ThePunisher-ReScriptExpert**: ReScript (OCaml-to-JS) typed frontend language.
- `coding/thepunisher-purescriptexpert.md` — **ThePunisher-PureScriptExpert**: PureScript strongly-typed functional language for JS targets.
- `coding/thepunisher-chapelhpclanguageexpert.md` — **ThePunisher-ChapelHPCLanguageExpert**: Chapel parallel/HPC programming language for supercomputing workloads.
- `coding/thepunisher-movelanguageexpert.md` — **ThePunisher-MoveLanguageExpert**: Move resource-oriented smart contract language (Aptos/Sui), architecturally distinct from Solidity.
- `coding/thepunisher-cairozklanguageexpert.md` — **ThePunisher-CairoZKLanguageExpert**: Cairo language for StarkNet zero-knowledge provable programs.
- `coding/thepunisher-vyperexpert.md` — **ThePunisher-VyperExpert**: Vyper Pythonic Ethereum smart-contract language, an alternative to Solidity.
- `coding/thepunisher-circomzkcircuitexpert.md` — **ThePunisher-CircomZKCircuitExpert**: Circom zero-knowledge circuit definition language.
- `coding/thepunisher-idrisdependenttypesexpert.md` — **ThePunisher-IdrisDependentTypesExpert**: Idris dependently-typed language for proof-carrying code.
- `coding/thepunisher-formalverificationtheoremprovingexpert.md` — **ThePunisher-FormalVerificationTheoremProvingExpert**: Formal verification and theorem proving (Coq/Lean/TLA+) applied to real codebases.
- `coding/thepunisher-zeroknowledgeproofcircuitengineeringexpert.md` — **ThePunisher-ZeroKnowledgeProofCircuitEngineeringExpert**: Zero-knowledge proof circuit engineering and constraint-system design.
- `coding/thepunisher-simdvectorizationoptimizationexpert.md` — **ThePunisher-SIMDVectorizationOptimizationExpert**: SIMD/vectorization performance optimization across ISAs.
- `coding/thepunisher-lockfreedatastructuredesignexpert.md` — **ThePunisher-LockFreeDataStructureDesignExpert**: Lock-free and wait-free concurrent data structure design.
- `coding/thepunisher-realtimedeterministicsystemsexpert.md` — **ThePunisher-RealTimeDeterministicSystemsExpert**: Hard real-time, deterministic-latency systems programming.
- `coding/thepunisher-distributedconsensusimplementationexpert.md` — **ThePunisher-DistributedConsensusImplementationExpert**: Implementation-level Raft/Paxos consensus algorithm engineering.
- `coding/thepunisher-bytecodevirtualmachinedesignexpert.md` — **ThePunisher-BytecodeVirtualMachineDesignExpert**: Bytecode virtual machine and dispatch-loop design, distinct from general compiler construction.
- `coding/thepunisher-staticanalysistoolauthoringexpert.md` — **ThePunisher-StaticAnalysisToolAuthoringExpert**: Authoring static-analysis tools and linters, not just using them.
- `coding/thepunisher-memoryallocatordesignexpert.md` — **ThePunisher-MemoryAllocatorDesignExpert**: Custom memory allocator design and implementation.
- `coding/thepunisher-jitcompilerimplementationexpert.md` — **ThePunisher-JITCompilerImplementationExpert**: Just-in-time compiler and runtime codegen implementation.
- `coding/thepunisher-garbagecollectorimplementationexpert.md` — **ThePunisher-GarbageCollectorImplementationExpert**: Garbage collector algorithm implementation.
- `coding/thepunisher-asyncruntimeimplementationexpert.md` — **ThePunisher-AsyncRuntimeImplementationExpert**: Async executor/runtime implementation (tokio-style), distinct from application-level concurrency usage.
- `coding/thepunisher-binaryprotocolcodecdesignexpert.md` — **ThePunisher-BinaryProtocolCodecDesignExpert**: Custom binary wire-protocol codec design, distinct from general serialization.
- `coding/thepunisher-terminaluiframeworkexpert.md` — **ThePunisher-TerminalUIFrameworkExpert**: Rich terminal UI (TUI) application framework engineering.
- `coding/thepunisher-crosscompilationtoolchainexpert.md` — **ThePunisher-CrossCompilationToolchainExpert**: Cross-compilation toolchain engineering across target architectures.
- `coding/thepunisher-languageserverprotocolimplementationexpert.md` — **ThePunisher-LanguageServerProtocolImplementationExpert**: Language Server Protocol (LSP) backend implementation for IDE tooling.
- `coding/thepunisher-macrometaprogrammingsystemdesignexpert.md` — **ThePunisher-MacroMetaprogrammingSystemDesignExpert**: Language-level macro/metaprogramming system design (Rust macros, Lisp macros, C++ templates).
- `coding/thepunisher-djangoframeworkexpert.md` — **ThePunisher-DjangoFrameworkExpert**: Django: ORM, admin, migrations, class-based views, production deployment patterns.
- `coding/thepunisher-fastapiframeworkexpert.md` — **ThePunisher-FastAPIFrameworkExpert**: FastAPI: async request handling, Pydantic models, dependency injection, OpenAPI generation.
- `coding/thepunisher-flaskframeworkexpert.md` — **ThePunisher-FlaskFrameworkExpert**: Flask: blueprints, application factories, extension ecosystem, WSGI deployment.
- `coding/thepunisher-pythondatascienceexpert.md` — **ThePunisher-PythonDataScienceExpert**: pandas/NumPy/SciPy: vectorized data manipulation, numerical computing, performance pitfalls.
- `coding/thepunisher-pythonasyncioexpert.md` — **ThePunisher-PythonAsyncioExpert**: asyncio internals: event loops, coroutines, task scheduling, async context managers, common deadlocks.
- `coding/thepunisher-pythonpackagingdistributionexpert.md` — **ThePunisher-PythonPackagingDistributionExpert**: setuptools/poetry/wheel/PyPI publishing, dependency resolution, editable installs, packaging pitfalls.
- `coding/thepunisher-pythonperformanceoptimizationexpert.md` — **ThePunisher-PythonPerformanceOptimizationExpert**: Cython/PyPy/profiling (cProfile, py-spy), GIL-aware optimization, C extension bridging.
- `coding/thepunisher-pythontypecheckingexpert.md` — **ThePunisher-PythonTypeCheckingExpert**: mypy/pyright, gradual typing, Protocol/generics design, type-stub authoring.
- `coding/thepunisher-pythontestingframeworkexpert.md` — **ThePunisher-PythonTestingFrameworkExpert**: advanced pytest (fixtures, parametrization, plugins), hypothesis property-based testing.
- `coding/thepunisher-pythonwebscrapingautomationexpert.md` — **ThePunisher-PythonWebScrapingAutomationExpert**: requests/httpx/Scrapy/Playwright-driven scraping, rate-limit-aware automation, anti-bot evasion (authorized use only).
- `coding/thepunisher-rustembeddedfirmwareexpert.md` — **ThePunisher-RustEmbeddedFirmwareExpert**: no_std Rust for embedded/firmware targets, distinct from application-level Rust work.
- `coding/thepunisher-pythonmetaclassdescriptorexpert.md` — **ThePunisher-PythonMetaclassDescriptorExpert**: Python metaprogramming: metaclasses, descriptors, and dunder-protocol design.
- `coding/thepunisher-webrtcrealtimecommunicationexpert.md` — **ThePunisher-WebRTCRealtimeCommunicationExpert**: WebRTC: peer-to-peer real-time media/data channels, NAT traversal, signaling design.
- `coding/thepunisher-edgecomputeruntimeexpert.md` — **ThePunisher-EdgeComputeRuntimeExpert**: edge/serverless compute runtimes (Cloudflare Workers, Deno Deploy): cold-start-free, geo-distributed code.
- `coding/thepunisher-nodejsbackendexpert.md` — **ThePunisher-NodeJSBackendExpert**: Node.js-specific backend patterns: event loop tuning, streams, worker threads, native addons.
- `coding/thepunisher-webgpuprogrammingexpert.md` — **ThePunisher-WebGPUProgrammingExpert**: WebGPU: modern browser GPU compute/graphics API, distinct from general CUDA/GPU programming.
- `coding/thepunisher-databasemigrationtoolingexpert.md` — **ThePunisher-DatabaseMigrationToolingExpert**: schema migration tooling (Alembic/Flyway/Prisma Migrate): zero-downtime migration strategy.
- `coding/thepunisher-trpctypesafeapiexpert.md` — **ThePunisher-TRPCTypeSafeAPIExpert**: tRPC: end-to-end type-safe APIs without a separate schema layer, distinct from GraphQL/REST.
- `coding/thepunisher-protocolbufferschemadesignexpert.md` — **ThePunisher-ProtocolBufferSchemaDesignExpert**: Protocol Buffers/gRPC schema design: versioning strategy, backward compatibility.
- `coding/thepunisher-infrastructureascodetypedexpert.md` — **ThePunisher-InfrastructureAsCodeTypedExpert**: typed infra-as-code (Pulumi/AWS CDK): using a real programming language instead of HCL/YAML.
- `coding/thepunisher-cmakebuildsystemexpert.md` — **ThePunisher-CMakeBuildSystemExpert**: CMake specifically: CMakeLists.txt authoring, generator expressions, cross-platform toolchain files -- the same specific-tool-under-a-general-umbrella pattern as the core roster's Django/FastAPI/Flask entries under the general BuildSystemExpert.
- `coding/thepunisher-packageregistrypublishingexpert.md` — **ThePunisher-PackageRegistryPublishingExpert**: Publishing packages to registries (npm, PyPI, crates.io, NuGet) correctly -- versioning, provenance, yanking a bad release -- distinct from PackageManagerExpert's consumer-side dependency resolution.
- `coding/thepunisher-codeformattertoolingexpert.md` — **ThePunisher-CodeFormatterToolingExpert**: Building/configuring code formatters (their AST-aware rewrite rules, idempotency guarantees) rather than just using one.
- `coding/thepunisher-incrementalcompilationexpert.md` — **ThePunisher-IncrementalCompilationExpert**: Designs incremental/caching compilation pipelines (dependency-aware rebuilds) -- distinct from CompilerExpert's general compiler-construction focus.
- `coding/thepunisher-sourcemapgenerationexpert.md` — **ThePunisher-SourceMapGenerationExpert**: Generates and validates source maps for transpiled/minified code so stack traces resolve back to real source.
- `coding/thepunisher-pluginarchitecturedesignexpert.md` — **ThePunisher-PluginArchitectureDesignExpert**: Designs a host application's own plugin/extension architecture (loading, sandboxing, versioned API surface).
- `coding/thepunisher-typeinferenceenginedesignexpert.md` — **ThePunisher-TypeInferenceEngineDesignExpert**: Designs a type-inference engine itself (Hindley-Milner-style unification) -- distinct from any single language's own type-system usage.
- `coding/thepunisher-parsercombinatordesignexpert.md` — **ThePunisher-ParserCombinatorDesignExpert**: Builds parsers via composable parser-combinator libraries -- distinct from CompilerExpert's broader front-to-back pipeline.
- `coding/thepunisher-asttransformationtoolingexpert.md` — **ThePunisher-ASTTransformationToolingExpert**: Builds codemods/AST-transformation tooling (jscodeshift-style rewrites) for large-scale automated code-base rewrites.
- `coding/thepunisher-hotreloadtoolingexpert.md` — **ThePunisher-HotReloadToolingExpert**: Implements hot-reload/hot-module-replacement machinery itself -- distinct from just consuming a framework's existing HMR.
- `coding/thepunisher-codecoverageinstrumentationexpert.md` — **ThePunisher-CodeCoverageInstrumentationExpert**: Builds code-coverage instrumentation (source/bytecode-level tracking) -- distinct from a testing-framework specialist's test-writing focus.
- `coding/thepunisher-serverlessfunctionruntimeexpert.md` — **ThePunisher-ServerlessFunctionRuntimeExpert**: Builds the runtime layer serverless functions execute in (cold-start optimization, isolate/sandbox lifecycle) -- distinct from application-level serverless usage.

## Team 5 — Reverse Engineering Command (70 growth agents)

- `reverse-engineering/thepunisher-ioskernelcacheanalysisexpert.md` — **ThePunisher-iOSKernelcacheAnalysisExpert**: ARM64 iOS kernelcache-specific reverse engineering.
- `reverse-engineering/thepunisher-bootkitrootkitanalysisexpert.md` — **ThePunisher-BootkitRootkitAnalysisExpert**: bootkit/rootkit detection and analysis (authorized only).
- `reverse-engineering/thepunisher-hypervisorvmescaperesearchexpert.md` — **ThePunisher-HypervisorVMEscapeResearchExpert**: authorized hypervisor/VM-escape vulnerability research.
- `reverse-engineering/thepunisher-uefibiosfirmwarereexpert.md` — **ThePunisher-UEFIBIOSFirmwareREExpert**: UEFI/BIOS firmware reverse engineering.
- `reverse-engineering/thepunisher-officemacromalwareanalysisexpert.md` — **ThePunisher-OfficeMacroMalwareAnalysisExpert**: VBA macro/malicious-document analysis.
- `reverse-engineering/thepunisher-browserextensionreexpert.md` — **ThePunisher-BrowserExtensionREExpert**: browser-extension reverse engineering.
- `reverse-engineering/thepunisher-cryptowalletbinaryreexpert.md` — **ThePunisher-CryptoWalletBinaryREExpert**: authorized cryptocurrency-wallet binary recovery research.
- `reverse-engineering/thepunisher-sdrsignalprotocolreexpert.md` — **ThePunisher-SDRSignalProtocolREExpert**: software-defined-radio signal/protocol reverse engineering.
- `reverse-engineering/thepunisher-automotiveecufirmwarereexpert.md` — **ThePunisher-AutomotiveECUFirmwareREExpert**: automotive ECU firmware reverse engineering (distinct from CAN bus protocol RE).
- `reverse-engineering/thepunisher-mlmodelformatreexpert.md` — **ThePunisher-MLModelFormatREExpert**: ML model file/architecture reverse engineering (safetensors/GGUF/ONNX).
- `reverse-engineering/thepunisher-unityil2cppreverseengineeringexpert.md` — **ThePunisher-UnityIL2CPPReverseEngineeringExpert**: Unity IL2CPP-compiled (C++-transpiled) game binary reverse engineering.
- `reverse-engineering/thepunisher-unrealengineblueprintdecompilationexpert.md` — **ThePunisher-UnrealEngineBlueprintDecompilationExpert**: Unreal Engine Blueprint VM bytecode decompilation and analysis.
- `reverse-engineering/thepunisher-androidnativesoanalysisexpert.md` — **ThePunisher-AndroidNativeSOAnalysisExpert**: Android native JNI/.so library reverse engineering, distinct from AndroidRE's APK/Dalvik/smali focus.
- `reverse-engineering/thepunisher-tlscertificatepinningbypassexpert.md` — **ThePunisher-TLSCertificatePinningBypassExpert**: mobile/app TLS certificate-pinning bypass for authorized traffic interception.
- `reverse-engineering/thepunisher-consolefirmwaredowngraderesearchexpert.md` — **ThePunisher-ConsoleFirmwareDowngradeResearchExpert**: console firmware downgrade and exploit-chain research, distinct from general FirmwareAnalyst.
- `reverse-engineering/thepunisher-protobufgrpcreverseengineeringexpert.md` — **ThePunisher-ProtobufGRPCReverseEngineeringExpert**: Protobuf/gRPC-based API reverse engineering, distinct from ProtocolRE's general packet-capture focus.
- `reverse-engineering/thepunisher-controlflowflatteningdeobfuscationexpert.md` — **ThePunisher-ControlFlowFlatteningDeobfuscationExpert**: control-flow-flattening deobfuscation, a specific obfuscation-defeat technique distinct from general ObfuscationBreaker/StringDeobfuscator.
- `reverse-engineering/thepunisher-gameengineassetbundleformatexpert.md` — **ThePunisher-GameEngineAssetBundleFormatExpert**: Unity AssetBundle and Unreal PAK container-format reverse engineering, distinct from GameAssetExtractor's broader extraction focus.
- `reverse-engineering/thepunisher-hardwaresecuritymoduleanalysisexpert.md` — **ThePunisher-HardwareSecurityModuleAnalysisExpert**: HSM/TPM hardware security-module analysis.
- `reverse-engineering/thepunisher-binaryfuzzingharnessconstructionexpert.md` — **ThePunisher-BinaryFuzzingHarnessConstructionExpert**: coverage-guided fuzzing-harness construction for closed-source binaries.
- `reverse-engineering/thepunisher-ebpfxdpbytecodeanalysisexpert.md` — **ThePunisher-EBPFXDPBytecodeAnalysisExpert**: eBPF/XDP kernel bytecode reverse engineering and verifier-behavior analysis.
- `reverse-engineering/thepunisher-wasisandboxescaperesearchexpert.md` — **ThePunisher-WASISandboxEscapeResearchExpert**: WASI capability-model sandbox escape research distinct from general WebAssembly bytecode RE.
- `reverse-engineering/thepunisher-containerruntimeescaperesearchexpert.md` — **ThePunisher-ContainerRuntimeEscapeResearchExpert**: Runtime container/cgroup/namespace breakout research, distinct from static container image analysis.
- `reverse-engineering/thepunisher-bluetoothclassicprotocolreexpert.md` — **ThePunisher-BluetoothClassicProtocolREExpert**: Bluetooth Classic (BR/EDR) protocol reverse engineering, a distinct stack from Bluetooth LE.
- `reverse-engineering/thepunisher-zigbeezwavemeshprotocolreexpert.md` — **ThePunisher-ZigbeeZWaveMeshProtocolREExpert**: Zigbee and Z-Wave smart-home mesh protocol reverse engineering.
- `reverse-engineering/thepunisher-lorawansubghzprotocolreexpert.md` — **ThePunisher-LoRaWANSubGHzProtocolREExpert**: LoRaWAN and sub-GHz long-range IoT RF protocol reverse engineering.
- `reverse-engineering/thepunisher-rootkitinlinehookdetectionexpert.md` — **ThePunisher-RootkitInlineHookDetectionExpert**: IAT/inline-hook and rootkit hooking-technique forensic detection and analysis.
- `reverse-engineering/thepunisher-smartcardemvapduprotocolreexpert.md` — **ThePunisher-SmartCardEMVAPDUProtocolREExpert**: ISO 7816/EMV smart-card APDU command protocol reverse engineering.
- `reverse-engineering/thepunisher-streamingmediadrmanalysisexpert.md` — **ThePunisher-StreamingMediaDRMAnalysisExpert**: Widevine/PlayReady streaming-media content-protection scheme analysis.
- `reverse-engineering/thepunisher-embeddedprintlanguagereexpert.md` — **ThePunisher-EmbeddedPrintLanguageREExpert**: PostScript/PJL embedded printer-language firmware reverse engineering.
- `reverse-engineering/thepunisher-esimjavacardappletreexpert.md` — **ThePunisher-ESIMJavaCardAppletREExpert**: eSIM and Java Card (GlobalPlatform) applet reverse engineering.
- `reverse-engineering/thepunisher-nonevmblockchainvmbytecodereexpert.md` — **ThePunisher-NonEVMBlockchainVMBytecodeREExpert**: Non-EVM blockchain VM bytecode RE (e.g. Solana BPF programs), distinct from EVM smart-contract bytecode.
- `reverse-engineering/thepunisher-firmwareotaupdatepackagereexpert.md` — **ThePunisher-FirmwareOTAUpdatePackageREExpert**: OTA firmware update package format and signature-verification research.
- `reverse-engineering/thepunisher-windowscomoleinterfacereexpert.md` — **ThePunisher-WindowsCOMOLEInterfaceREExpert**: Windows COM/OLE interface vtable analysis and IDL reconstruction.
- `reverse-engineering/thepunisher-industrialplcladderlogicdecompilationexpert.md` — **ThePunisher-IndustrialPLCLadderLogicDecompilationExpert**: ICS/SCADA PLC ladder-logic program decompilation and analysis.
- `reverse-engineering/thepunisher-voipsiprtpprotocolreexpert.md` — **ThePunisher-VoIPSIPRTPProtocolREExpert**: Proprietary SIP/RTP VoIP protocol extension reverse engineering.
- `reverse-engineering/thepunisher-pcbtracereconstructionexpert.md` — **ThePunisher-PCBTraceReconstructionExpert**: Board-level PCB trace and net reconstruction for hardware reverse engineering.
- `reverse-engineering/thepunisher-maliciousdocumentexploitanalysisexpert.md` — **ThePunisher-MaliciousDocumentExploitAnalysisExpert**: Malicious PDF/Office document embedded exploit shellcode analysis.
- `reverse-engineering/thepunisher-qnxrtosbinaryanalysisexpert.md` — **ThePunisher-QNXRTOSBinaryAnalysisExpert**: QNX and other real-time OS binary format and toolchain analysis.
- `reverse-engineering/thepunisher-avionicsfirmwarereexpert.md` — **ThePunisher-AvionicsFirmwareREExpert**: Aerospace/avionics embedded firmware reverse engineering research.
- `reverse-engineering/thepunisher-posterminalfirmwarereexpert.md` — **ThePunisher-POSTerminalFirmwareREExpert**: Point-of-sale payment terminal firmware reverse engineering.
- `reverse-engineering/thepunisher-nfcprotocolreexpert.md` — **ThePunisher-NFCProtocolREExpert**: ISO 14443 NFC protocol reverse engineering, distinct from Bluetooth/BLE.
- `reverse-engineering/thepunisher-gnsssignalprotocolreexpert.md` — **ThePunisher-GNSSSignalProtocolREExpert**: GPS/GNSS signal and message-format reverse engineering research.
- `reverse-engineering/thepunisher-proprietarynetworkfilesystemprotocolreexpert.md` — **ThePunisher-ProprietaryNetworkFilesystemProtocolREExpert**: Proprietary enterprise-appliance network filesystem protocol RE.
- `reverse-engineering/thepunisher-automotiveinfotainmentsystemreexpert.md` — **ThePunisher-AutomotiveInfotainmentSystemREExpert**: Automotive head-unit/infotainment OS and application reverse engineering, distinct from ECU firmware RE.
- `reverse-engineering/thepunisher-medicaldevicefirmwarereexpert.md` — **ThePunisher-MedicalDeviceFirmwareREExpert**: Regulated medical-device embedded firmware reverse engineering.
- `reverse-engineering/thepunisher-mainframebinaryreexpert.md` — **ThePunisher-MainframeBinaryREExpert**: z/OS mainframe assembler/COBOL binary reverse engineering.
- `reverse-engineering/thepunisher-videocodeccontainerformatreexpert.md` — **ThePunisher-VideoCodecContainerFormatREExpert**: Media container/codec structure reverse engineering for malformed-file exploit research.
- `reverse-engineering/thepunisher-licenseserverprotocolreexpert.md` — **ThePunisher-LicenseServerProtocolREExpert**: License-server network protocol RE (e.g. FlexLM-style), distinct from license-key format analysis.
- `reverse-engineering/thepunisher-customcompressionalgorithmreexpert.md` — **ThePunisher-CustomCompressionAlgorithmREExpert**: Proprietary/custom compression algorithm reverse engineering for obfuscated assets and payloads.
- `reverse-engineering/thepunisher-riscvbinaryanalysisexpert.md` — **ThePunisher-RISCVBinaryAnalysisExpert**: RISC-V ISA-specific static/dynamic binary analysis.
- `reverse-engineering/thepunisher-mipsbinaryanalysisexpert.md` — **ThePunisher-MIPSBinaryAnalysisExpert**: MIPS ISA binary analysis, common in routers and embedded devices.
- `reverse-engineering/thepunisher-powerpcbinaryanalysisexpert.md` — **ThePunisher-PowerPCBinaryAnalysisExpert**: PowerPC ISA binary analysis, common in older consoles and industrial systems.
- `reverse-engineering/thepunisher-udsdiagnosticprotocolreexpert.md` — **ThePunisher-UDSDiagnosticProtocolREExpert**: UDS/OBD-II automotive diagnostic protocol RE, distinct from raw CAN bus data-link analysis.
- `reverse-engineering/thepunisher-modbusscadaprotocolreexpert.md` — **ThePunisher-ModbusSCADAProtocolREExpert**: Modbus/SCADA industrial control protocol reverse engineering.
- `reverse-engineering/thepunisher-satellitecommunicationprotocolreexpert.md` — **ThePunisher-SatelliteCommunicationProtocolREExpert**: satellite communication protocol RE, distinct from GNSS positioning signal analysis.
- `reverse-engineering/thepunisher-threadmattersmarthomeprotocolreexpert.md` — **ThePunisher-ThreadMatterSmartHomeProtocolREExpert**: Matter/Thread smart-home protocol reverse engineering.
- `reverse-engineering/thepunisher-wirelesshiddongleprotocolreexpert.md` — **ThePunisher-WirelessHIDDongleProtocolREExpert**: proprietary 2.4GHz wireless keyboard/mouse dongle protocol RE (e.g. Logitech Unifying-class).
- `reverse-engineering/thepunisher-routerfirmwarebackdooranalysisexpert.md` — **ThePunisher-RouterFirmwareBackdoorAnalysisExpert**: SOHO router firmware analysis for backdoors and hidden services.
- `reverse-engineering/thepunisher-smarttvfirmwarereexpert.md` — **ThePunisher-SmartTVFirmwareREExpert**: smart TV embedded firmware and casting-protocol reverse engineering.
- `reverse-engineering/thepunisher-eidpassportchipanalysisexpert.md` — **ThePunisher-EIDPassportChipAnalysisExpert**: electronic passport/ID RFID chip analysis, distinct from general smart-card EMV APDU work.
- `reverse-engineering/thepunisher-memoryforensicsvolatilityexpert.md` — **ThePunisher-MemoryForensicsVolatilityExpert**: live RAM forensics (Volatility-style memory image analysis).
- `reverse-engineering/thepunisher-thunderboltdmaattackresearchexpert.md` — **ThePunisher-ThunderboltDMAAttackResearchExpert**: PCIe/Thunderbolt DMA attack research against live systems.
- `reverse-engineering/thepunisher-macoskernelextensionanalysisexpert.md` — **ThePunisher-MacOSKernelExtensionAnalysisExpert**: macOS kext (kernel extension) reverse engineering, distinct from iOS kernelcache analysis.
- `reverse-engineering/thepunisher-arm64pointerauthenticationbypassexpert.md` — **ThePunisher-ARM64PointerAuthenticationBypassExpert**: modern ARM64 Pointer Authentication (PAC) / Branch Target Identification bypass research.
- `reverse-engineering/thepunisher-firmwaresupplychainimplantanalysisexpert.md` — **ThePunisher-FirmwareSupplyChainImplantAnalysisExpert**: detecting and analyzing supply-chain-implanted firmware tampering.
- `reverse-engineering/thepunisher-windowsregistryforensicsexpert.md` — **ThePunisher-WindowsRegistryForensicsExpert**: Windows Registry-based persistence and forensic timeline analysis.
- `reverse-engineering/thepunisher-digitaltvbroadcastprotocolreexpert.md` — **ThePunisher-DigitalTVBroadcastProtocolREExpert**: DVB/ATSC digital TV broadcast stream reverse engineering.
- `reverse-engineering/thepunisher-industrialfieldbusprofinetreexpert.md` — **ThePunisher-IndustrialFieldbusProfinetREExpert**: Profinet and other industrial fieldbus protocol reverse engineering, distinct from Modbus.
- `reverse-engineering/thepunisher-gamecontrollerprotocolreexpert.md` — **ThePunisher-GameControllerProtocolREExpert**: proprietary game controller USB/Bluetooth protocol RE (inputs, rumble/haptics).

## Team 6 — Debug & Diagnosis (20 growth agents)

- `debug/thepunisher-distributedtracingdebugger.md` — **ThePunisher-DistributedTracingDebugger**: OpenTelemetry/Jaeger trace analysis to pinpoint cross-service latency and failure sources.
- `debug/thepunisher-productionincidentdebugger.md` — **ThePunisher-ProductionIncidentDebugger**: live-production, SRE-style incident debugging under time pressure with real user impact.
- `debug/thepunisher-gpucudadebugger.md` — **ThePunisher-GPUCUDADebugger**: CUDA kernel debugging: race conditions, memory faults, cuda-gdb/compute-sanitizer workflows.
- `debug/thepunisher-embeddedhardwaredebugger.md` — **ThePunisher-EmbeddedHardwareDebugger**: JTAG/SWD-based embedded software debugging in a fix-the-bug workflow, distinct from Team 5's RE focus.
- `debug/thepunisher-recordreplaytimetraveldebugger.md` — **ThePunisher-RecordReplayTimeTravelDebugger**: record/replay debugging (rr, WinDbg Time Travel Debugging) to deterministically reproduce bugs.
- `debug/thepunisher-microservicesservicemeshdebugger.md` — **ThePunisher-MicroservicesServiceMeshDebugger**: debugging failures across a service mesh (Istio/Linkerd): retries, circuit breakers, sidecar issues.
- `debug/thepunisher-kubernetespoddebugger.md` — **ThePunisher-KubernetesPodDebugger**: debugging pod crash loops, OOMKills, scheduling failures, and misconfigured probes.
- `debug/thepunisher-jitcompiledlanguagedebugger.md` — **ThePunisher-JITCompiledLanguageDebugger**: debugging JIT-compiled runtimes (JVM/V8/.NET): deoptimization bugs, JIT-vs-interpreter divergence.
- `debug/thepunisher-tlshandshakedebugger.md` — **ThePunisher-TLSHandshakeDebugger**: debugging failed TLS handshakes/cert chains in application context, distinct from RE's crypto analysis.
- `debug/thepunisher-mlmodeltrainingdebugger.md` — **ThePunisher-MLModelTrainingDebugger**: debugging ML training runs: NaN/exploding gradients, numeric instability, silent data pipeline bugs.
- `debug/thepunisher-eventdrivenreactivesystemdebugger.md` — **ThePunisher-EventDrivenReactiveSystemDebugger**: debugging event-driven/reactive pipelines: message ordering, backpressure, lost events.
- `debug/thepunisher-browserextensiondebugger.md` — **ThePunisher-BrowserExtensionDebugger**: debugging browser extension bugs across content scripts, background workers, and message passing.
- `debug/thepunisher-legacymainframecoboldebugger.md` — **ThePunisher-LegacyMainframeCOBOLDebugger**: debugging legacy COBOL/mainframe batch jobs and JCL failures.
- `debug/thepunisher-realtimeaudiovideopipelinedebugger.md` — **ThePunisher-RealTimeAudioVideoPipelineDebugger**: debugging real-time A/V pipeline glitches: buffer underruns, sync drift, codec issues.
- `debug/thepunisher-gameengineframedropdebugger.md` — **ThePunisher-GameEngineFrameDropDebugger**: debugging game engine frame-time spikes and stutter, distinct from general performance profiling.
- `debug/thepunisher-smartcontracttransactiondebugger.md` — **ThePunisher-SmartContractTransactionDebugger**: debugging failed/reverted smart contract transactions and gas estimation issues.
- `debug/thepunisher-serverlesscoldstartdebugger.md` — **ThePunisher-ServerlessColdStartDebugger**: debugging serverless/Lambda cold-start latency and timeout failures.
- `debug/thepunisher-cdncachedebugger.md` — **ThePunisher-CDNCacheDebugger**: debugging edge/CDN caching bugs (stale content, cache-key mismatches), distinct from app-level cache invalidation.
- `debug/thepunisher-webassemblyruntimedebugger.md` — **ThePunisher-WebAssemblyRuntimeDebugger**: debugging WASM runtime issues: memory boundary errors, host-function binding bugs.
- `debug/thepunisher-featureflagrolloutdebugger.md` — **ThePunisher-FeatureFlagRolloutDebugger**: debugging bugs introduced or masked by feature-flag rollout state and targeting rules.

## Team 11 — Security & Pentest (10 growth agents)

- `security-pentest/thepunisher-securityaimodelredteamingexpert.md` — **ThePunisher-SecurityAIModelRedTeamingExpert**: adversarial-robustness security assessment of ML/AI models themselves, distinct from Team 59's LLM-application prompt-injection focus.
- `security-pentest/thepunisher-securitypostquantumcryptographymigrationexpert.md` — **ThePunisher-SecurityPostQuantumCryptographyMigrationExpert**: post-quantum cryptography migration-readiness assessment.
- `security-pentest/thepunisher-securitysbomgenerationauditexpert.md` — **ThePunisher-SecuritySBOMGenerationAuditExpert**: Software Bill of Materials (SBOM) generation and audit.
- `security-pentest/thepunisher-securityapiratelimitabusetesterexpert.md` — **ThePunisher-SecurityAPIRateLimitAbuseTesterExpert**: API rate-limit and abuse-resistance testing.
- `security-pentest/thepunisher-securitywebsocketpentestexpert.md` — **ThePunisher-SecurityWebSocketPentestExpert**: WebSocket-protocol-specific penetration testing.
- `security-pentest/thepunisher-securitygraphqlpentestexpert.md` — **ThePunisher-SecurityGraphQLPentestExpert**: GraphQL-specific penetration testing (introspection abuse, query-depth attacks, batching abuse).
- `security-pentest/thepunisher-securitycontainerimagesupplychainauditorexpert.md` — **ThePunisher-SecurityContainerImageSupplyChainAuditorExpert**: container-image provenance and signing supply-chain auditing.
- `security-pentest/thepunisher-securityserializationdeserializationauditorexpert.md` — **ThePunisher-SecuritySerializationDeserializationAuditorExpert**: insecure-deserialization vulnerability-class auditing.
- `security-pentest/thepunisher-securitybusinesslogicabusetesterexpert.md` — **ThePunisher-SecurityBusinessLogicAbuseTesterExpert**: business-logic abuse testing (price manipulation, workflow bypass, race-condition exploitation).
- `security-pentest/thepunisher-securitymobileappbinaryhardeningauditorexpert.md` — **ThePunisher-SecurityMobileAppBinaryHardeningAuditorExpert**: mobile-app binary-hardening audit, distinct from MobileAppPentester's active-testing focus.

## Team 13 — Code Review & Quality (10 growth agents)

- `code-review/thepunisher-codereviewaiassistedprescreeningexpert.md` — **ThePunisher-CodeReviewAIAssistedPreScreeningExpert**: LLM-based pre-screening of a diff before human review, distinct from human review itself.
- `code-review/thepunisher-codereviewmonorepoimpactanalysisexpert.md` — **ThePunisher-CodeReviewMonorepoImpactAnalysisExpert**: blast-radius/impact analysis of a change across a monorepo.
- `code-review/thepunisher-concurrencyraceconditionreviewexpert.md` — **ThePunisher-ConcurrencyRaceConditionReviewExpert**: concurrency race-condition-focused code review, distinct from Team 4's own concurrency-implementation expertise.
- `code-review/thepunisher-codereviewflakytestdetectionexpert.md` — **ThePunisher-CodeReviewFlakyTestDetectionExpert**: flaky-test pattern detection during code review.
- `code-review/thepunisher-infrastructureascodereviewexpert.md` — **ThePunisher-InfrastructureAsCodeReviewExpert**: Terraform/CloudFormation/Pulumi-specific infrastructure-as-code review discipline.
- `code-review/thepunisher-codereviewsecretsleakagepreventionexpert.md` — **ThePunisher-CodeReviewSecretsLeakagePreventionExpert**: pre-merge secrets-leakage review gate, distinct from Team 11's own scanning-tool operation.
- `code-review/thepunisher-codereviewfeatureflagcleanupauditorexpert.md` — **ThePunisher-CodeReviewFeatureFlagCleanupAuditorExpert**: stale feature-flag cleanup auditing during review.
- `code-review/thepunisher-codereviewgeneratedcodequalityauditorexpert.md` — **ThePunisher-CodeReviewGeneratedCodeQualityAuditorExpert**: review discipline specifically for AI/LLM-generated code contributions (hallucination risk, unverified claims, over-engineering).
- `code-review/thepunisher-codereviewcrossrepoconsistencyauditorexpert.md` — **ThePunisher-CodeReviewCrossRepoConsistencyAuditorExpert**: cross-repository consistency auditing across an organization's multiple codebases.
- `code-review/thepunisher-codereviewonboardingmentorshipexpert.md` — **ThePunisher-CodeReviewOnboardingMentorshipExpert**: using code review as a structured mentorship/onboarding tool for new engineers.

## Team 50 — API Design & Developer Documentation Engineering (10 growth agents)

- `api-docs-design/thepunisher-developeradvocacyexpert.md` — **ThePunisher-DeveloperAdvocacyExpert**: External developer-advocacy strategy: which channels, which developers to court, trust-building distinct from marketing.
- `api-docs-design/thepunisher-devrelcommunityengagementexpert.md` — **ThePunisher-DevRelCommunityEngagementExpert**: The human practice of community engagement (AMAs, Discord/Slack presence, community programs) -- distinct from APIDeveloperCommunityPlatformExpert's platform-building.
- `api-docs-design/thepunisher-devrelcontentstrategyexpert.md` — **ThePunisher-DevRelContentStrategyExpert**: Editorial calendar/content strategy spanning blog, talks, and tutorials -- distinct from any single content format.
- `api-docs-design/thepunisher-hackathonprogramexpert.md` — **ThePunisher-HackathonProgramExpert**: Hackathon program design: judging criteria, sponsor developer engagement, prize structure.
- `api-docs-design/thepunisher-devrelmetricsexpert.md` — **ThePunisher-DevRelMetricsExpert**: Measuring DevRel program impact (adoption/activation/community health), distinct from product-usage analytics.
- `api-docs-design/thepunisher-technicalblogwritingexpert.md` — **ThePunisher-TechnicalBlogWritingExpert**: Narrative/thought-leadership blog content for developer audiences, distinct from task-oriented tutorial docs.
- `api-docs-design/thepunisher-conferencetalkpreparationexpert.md` — **ThePunisher-ConferenceTalkPreparationExpert**: Technical conference talk and workshop content design for developer audiences.
- `api-docs-design/thepunisher-opensourcecommunitymanagementexpert.md` — **ThePunisher-OpenSourceCommunityManagementExpert**: OSS project governance, contributor onboarding, and issue-triage policy for an open-source project.
- `api-docs-design/thepunisher-devrelsurveydesignexpert.md` — **ThePunisher-DevRelSurveyDesignExpert**: Developer satisfaction/NPS survey design and analysis for a DevRel program.
- `api-docs-design/thepunisher-developerecosystempartnershipexpert.md` — **ThePunisher-DeveloperEcosystemPartnershipExpert**: Third-party integration partner enablement, distinct from internal API design.

## Team 59 — Red Team Operations Engineering (20 growth agents)

- `red-team-ops/thepunisher-redteamc2protocoldesignexpert.md` — **ThePunisher-RedTeamC2ProtocolDesignExpert**: custom C2 communication-protocol design for authorized engagements.
- `red-team-ops/thepunisher-redteamfirmwareimplantresearchexpert.md` — **ThePunisher-RedTeamFirmwareImplantResearchExpert**: authorized firmware-level implant research.
- `red-team-ops/thepunisher-redteamaimodelpoisoningresearchexpert.md` — **ThePunisher-RedTeamAIModelPoisoningResearchExpert**: authorized ML model-poisoning/adversarial-input research.
- `red-team-ops/thepunisher-redteamhardwareimplantresearchexpert.md` — **ThePunisher-RedTeamHardwareImplantResearchExpert**: authorized hardware-implant/rogue-device research.
- `red-team-ops/thepunisher-redteamvoipattacksimulationexpert.md` — **ThePunisher-RedTeamVoIPAttackSimulationExpert**: authorized VoIP/telephony attack simulation.
- `red-team-ops/thepunisher-redteambiometricbypassresearchexpert.md` — **ThePunisher-RedTeamBiometricBypassResearchExpert**: authorized biometric-authentication bypass research.
- `red-team-ops/thepunisher-redteamcryptowalletattacksimulationexpert.md` — **ThePunisher-RedTeamCryptoWalletAttackSimulationExpert**: authorized cryptocurrency-wallet attack simulation.
- `red-team-ops/thepunisher-redteamarvrattacksurfaceexpert.md` — **ThePunisher-RedTeamARVRAttackSurfaceExpert**: authorized AR/VR-device attack-surface research.
- `red-team-ops/thepunisher-redteamquantumthreatsimulationexpert.md` — **ThePunisher-RedTeamQuantumThreatSimulationExpert**: forward-looking authorized simulation of quantum-computing threats to current cryptography.
- `red-team-ops/thepunisher-redteamsatelliteattacksimulationexpert.md` — **ThePunisher-RedTeamSatelliteAttackSimulationExpert**: authorized satellite/space-segment attack simulation.
- `red-team-ops/thepunisher-redteamdeepfakevishingexpert.md` — **ThePunisher-RedTeamDeepfakeVishingExpert**: voice-cloning/deepfake-based vishing social-engineering research (authorized).
- `red-team-ops/thepunisher-redteammfabypassresearchexpert.md` — **ThePunisher-RedTeamMFABypassResearchExpert**: multi-factor-authentication bypass research (authorized).
- `red-team-ops/thepunisher-redteamgraphapiabuseexpert.md` — **ThePunisher-RedTeamGraphAPIAbuseExpert**: Microsoft Graph API abuse techniques in M365 red-team engagements.
- `red-team-ops/thepunisher-redteambadgecloningphysicalaccessexpert.md` — **ThePunisher-RedTeamBadgeCloningPhysicalAccessExpert**: RFID/badge-cloning physical-access-control bypass for authorized physical red-team engagements.
- `red-team-ops/thepunisher-redteamcobaltstrikeprofileengineeringexpert.md` — **ThePunisher-RedTeamCobaltStrikeProfileEngineeringExpert**: malleable C2 profile engineering (Cobalt Strike-style).
- `red-team-ops/thepunisher-redteamllmpromptinjectionattackexpert.md` — **ThePunisher-RedTeamLLMPromptInjectionAttackExpert**: prompt-injection attack research against target LLM/AI-agent systems (authorized).
- `red-team-ops/thepunisher-redteamcontainerregistrypoisoningexpert.md` — **ThePunisher-RedTeamContainerRegistryPoisoningExpert**: container-registry poisoning attack-simulation research.
- `red-team-ops/thepunisher-redteamdnstunnelingc2expert.md` — **ThePunisher-RedTeamDNSTunnelingC2Expert**: DNS-tunneling command-and-control channel engineering.
- `red-team-ops/thepunisher-redteampasswordsprayautomationexpert.md` — **ThePunisher-RedTeamPasswordSprayAutomationExpert**: password-spray attack automation for authorized engagements.
- `red-team-ops/thepunisher-redteammacostradecraftexpert.md` — **ThePunisher-RedTeamMacOSTradecraftExpert**: macOS-specific red-team tradecraft, a real gap versus this team's Windows/Linux-centric default coverage.

## Team 60 — Blue Team & Defensive Security Operations Engineering (20 growth agents)

- `blue-team-defense/thepunisher-blueteamaithreatdetectionexpert.md` — **ThePunisher-BlueTeamAIThreatDetectionExpert**: AI/ML-based threat-detection engineering.
- `blue-team-defense/thepunisher-blueteamcloudnativedetectionexpert.md` — **ThePunisher-BlueTeamCloudNativeDetectionExpert**: Kubernetes/container-native detection engineering.
- `blue-team-defense/thepunisher-blueteamsupplychaindefenseexpert.md` — **ThePunisher-BlueTeamSupplyChainDefenseExpert**: supply-chain-attack defensive-monitoring engineering.
- `blue-team-defense/thepunisher-blueteamquantumsafemigrationexpert.md` — **ThePunisher-BlueTeamQuantumSafeMigrationExpert**: defensive post-quantum-cryptography migration planning.
- `blue-team-defense/thepunisher-blueteamiotdefenseexpert.md` — **ThePunisher-BlueTeamIoTDefenseExpert**: IoT-specific defensive-monitoring engineering.
- `blue-team-defense/thepunisher-blueteamthreathuntingmlexpert.md` — **ThePunisher-BlueTeamThreatHuntingMLExpert**: ML-assisted threat-hunting engineering.
- `blue-team-defense/thepunisher-blueteamransomwarerecoveryplaybookexpert.md` — **ThePunisher-BlueTeamRansomwareRecoveryPlaybookExpert**: ransomware recovery/restoration-specific playbook engineering.
- `blue-team-defense/thepunisher-blueteamzerotrustimplementationexpert.md` — **ThePunisher-BlueTeamZeroTrustImplementationExpert**: defensive zero-trust-architecture implementation engineering.
- `blue-team-defense/thepunisher-blueteamsecuritydatascienceexpert.md` — **ThePunisher-BlueTeamSecurityDataScienceExpert**: statistical/data-science approaches to security analytics.
- `blue-team-defense/thepunisher-blueteamcontainerruntimesecurityexpert.md` — **ThePunisher-BlueTeamContainerRuntimeSecurityExpert**: runtime container-security monitoring (Falco-style).
- `blue-team-defense/thepunisher-blueteamdeepfakedetectionexpert.md` — **ThePunisher-BlueTeamDeepfakeDetectionExpert**: deepfake/voice-clone detection for defensive security.
- `blue-team-defense/thepunisher-blueteamhoneytokenengineeringexpert.md` — **ThePunisher-BlueTeamHoneytokenEngineeringExpert**: honeytoken/canary-token engineering, distinct from DeceptionTechnologyExpert's broader deception-platform scope.
- `blue-team-defense/thepunisher-blueteamthreathuntingquerylibraryexpert.md` — **ThePunisher-BlueTeamThreatHuntingQueryLibraryExpert**: reusable threat-hunt query-library engineering, distinct from ThreatHuntingExpert's own hunting practice.
- `blue-team-defense/thepunisher-blueteamoticsintrusiondetectionexpert.md` — **ThePunisher-BlueTeamOTICSIntrusionDetectionExpert**: OT/ICS-specific intrusion-detection engineering.
- `blue-team-defense/thepunisher-blueteammacosendpointdefenseexpert.md` — **ThePunisher-BlueTeamMacOSEndpointDefenseExpert**: macOS-specific endpoint defense, mirrors the same real Windows/Linux-centric-coverage gap on the red-team side.
- `blue-team-defense/thepunisher-blueteamllmsecuritymonitoringexpert.md` — **ThePunisher-BlueTeamLLMSecurityMonitoringExpert**: monitoring AI/LLM usage and outputs for security anomalies.
- `blue-team-defense/thepunisher-blueteampasswordspraydetectionexpert.md` — **ThePunisher-BlueTeamPasswordSprayDetectionExpert**: password-spray attack detection engineering.
- `blue-team-defense/thepunisher-blueteamkerberosattackdetectionexpert.md` — **ThePunisher-BlueTeamKerberosAttackDetectionExpert**: Kerberos attack (golden/silver ticket, pass-the-hash) detection engineering.
- `blue-team-defense/thepunisher-blueteamdnstunnelingdetectionexpert.md` — **ThePunisher-BlueTeamDNSTunnelingDetectionExpert**: DNS-tunneling C2-channel detection engineering.
- `blue-team-defense/thepunisher-blueteamcobaltstrikec2detectionexpert.md` — **ThePunisher-BlueTeamCobaltStrikeC2DetectionExpert**: Cobalt Strike-style beacon/C2 traffic fingerprinting and detection engineering.

## Team 61 — Purple Team & Cyber Exercise Operations Engineering (20 growth agents)

- `purple-team-exercises/thepunisher-purpleteamcloudexercisedesignexpert.md` — **ThePunisher-PurpleTeamCloudExerciseDesignExpert**: cloud-specific purple team exercise design.
- `purple-team-exercises/thepunisher-purpleteamoticsexercisedesignexpert.md` — **ThePunisher-PurpleTeamOTICSExerciseDesignExpert**: OT/ICS-specific purple team exercise design.
- `purple-team-exercises/thepunisher-purpleteamairedteamingexpert.md` — **ThePunisher-PurpleTeamAIRedTeamingExpert**: AI/LLM red-teaming exercise design.
- `purple-team-exercises/thepunisher-purpleteamsupplychainexercisedesignexpert.md` — **ThePunisher-PurpleTeamSupplyChainExerciseDesignExpert**: supply-chain-attack purple team exercise design.
- `purple-team-exercises/thepunisher-purpleteamcyberinsurancereadinessexpert.md` — **ThePunisher-PurpleTeamCyberInsuranceReadinessExpert**: exercises validating cyber-insurance-readiness requirements.
- `purple-team-exercises/thepunisher-purpleteamtabletopscenariolibraryexpert.md` — **ThePunisher-PurpleTeamTabletopScenarioLibraryExpert**: maintaining a reusable tabletop-exercise scenario library.
- `purple-team-exercises/thepunisher-purpleteamexerciseautomationscriptingexpert.md` — **ThePunisher-PurpleTeamExerciseAutomationScriptingExpert**: scripting/automating recurring purple team exercise execution.
- `purple-team-exercises/thepunisher-purpleteamthirdpartyriskexerciseexpert.md` — **ThePunisher-PurpleTeamThirdPartyRiskExerciseExpert**: third-party/vendor-risk-focused exercise design.
- `purple-team-exercises/thepunisher-purpleteamexecutivetabletopfacilitationexpert.md` — **ThePunisher-PurpleTeamExecutiveTabletopFacilitationExpert**: C-suite/board-level tabletop-exercise facilitation.
- `purple-team-exercises/thepunisher-purpleteamcontinuousvalidationdashboardexpert.md` — **ThePunisher-PurpleTeamContinuousValidationDashboardExpert**: continuous control-validation dashboard engineering.
- `purple-team-exercises/thepunisher-purpleteamdeepfakeexercisedesignexpert.md` — **ThePunisher-PurpleTeamDeepfakeExerciseDesignExpert**: deepfake/vishing-based social-engineering exercise design.
- `purple-team-exercises/thepunisher-purpleteammacosexercisedesignexpert.md` — **ThePunisher-PurpleTeamMacOSExerciseDesignExpert**: macOS-specific red/blue exercise design, mirrors the same platform-coverage gap.
- `purple-team-exercises/thepunisher-purpleteamkerberosdetectionvalidationexpert.md` — **ThePunisher-PurpleTeamKerberosDetectionValidationExpert**: validating blue-team Kerberos-attack detections against real red-team golden/silver-ticket runs.
- `purple-team-exercises/thepunisher-purpleteamc2detectionvalidationexpert.md` — **ThePunisher-PurpleTeamC2DetectionValidationExpert**: validating C2/beacon-traffic detection against real red-team C2 infrastructure.
- `purple-team-exercises/thepunisher-purpleteamransomwaretabletopexpert.md` — **ThePunisher-PurpleTeamRansomwareTabletopExpert**: ransomware-scenario tabletop exercise design.
- `purple-team-exercises/thepunisher-purpleteamphysicalsocialengineeringexerciseexpert.md` — **ThePunisher-PurpleTeamPhysicalSocialEngineeringExerciseExpert**: physical-access/social-engineering exercise design and validation.
- `purple-team-exercises/thepunisher-purpleteamdetectionascodeexpert.md` — **ThePunisher-PurpleTeamDetectionAsCodeExpert**: Detection-as-Code CI/CD pipeline engineering for automated detection validation.
- `purple-team-exercises/thepunisher-purpleteamregulatoryexamsimulationexpert.md` — **ThePunisher-PurpleTeamRegulatoryExamSimulationExpert**: regulatory-exam/audit scenario simulation design.
- `purple-team-exercises/thepunisher-purpleteammobileexercisedesignexpert.md` — **ThePunisher-PurpleTeamMobileExerciseDesignExpert**: mobile-platform-specific red/blue exercise design.
- `purple-team-exercises/thepunisher-purpleteamthreathuntingqueryvalidationexpert.md` — **ThePunisher-PurpleTeamThreatHuntingQueryValidationExpert**: validating blue-team hunt-query-library effectiveness against real red-team exercise runs.

## Team 69 — Game Hacking & Private Game Server Engineering (10 growth agents)

- `game-hacking/thepunisher-gamehackingmobileclientreexpert.md` — **ThePunisher-GameHackingMobileClientREExpert**: mobile-game-specific client reverse engineering.
- `game-hacking/thepunisher-gameservermatchmakingsystemexpert.md` — **ThePunisher-GameServerMatchmakingSystemExpert**: matchmaking-system reconstruction engineering.
- `game-hacking/thepunisher-gameservervoicechatintegrationexpert.md` — **ThePunisher-GameServerVoiceChatIntegrationExpert**: in-game voice-chat integration engineering.
- `game-hacking/thepunisher-gamehackingconsoleclientreexpert.md` — **ThePunisher-GameHackingConsoleClientREExpert**: console-specific game-client reverse engineering for private servers.
- `game-hacking/thepunisher-gameservercrossplatformplayexpert.md` — **ThePunisher-GameServerCrossPlatformPlayExpert**: cross-play private-server support engineering.
- `game-hacking/thepunisher-gameeconomyexploitanalysisexpert.md` — **ThePunisher-GameEconomyExploitAnalysisExpert**: analyzing dupe/exploit bugs to fix on private servers.
- `game-hacking/thepunisher-gameserverseasonalcontentschedulingexpert.md` — **ThePunisher-GameServerSeasonalContentSchedulingExpert**: seasonal-content scheduling-system engineering.
- `game-hacking/thepunisher-gamehackingvrclientreexpert.md` — **ThePunisher-GameHackingVRClientREExpert**: VR-game client reverse engineering.
- `game-hacking/thepunisher-gameserverplayerdataprivacyexpert.md` — **ThePunisher-GameServerPlayerDataPrivacyExpert**: private-server player-data privacy engineering.
- `game-hacking/thepunisher-gamemodcommunitydistributionplatformexpert.md` — **ThePunisher-GameModCommunityDistributionPlatformExpert**: mod-distribution/community-platform engineering.

## Team 70 — Cross-Platform Design Systems Engineering (10 growth agents)

- `design-systems/thepunisher-designsystemaicomponentgenerationexpert.md` — **ThePunisher-DesignSystemAIComponentGenerationExpert**: AI-assisted design-system component-generation tooling.
- `design-systems/thepunisher-designsystemgameuiintegrationexpert.md` — **ThePunisher-DesignSystemGameUIIntegrationExpert**: bridging the design system to game-UI conventions.
- `design-systems/thepunisher-designsystemarvrcomponentexpert.md` — **ThePunisher-DesignSystemARVRComponentExpert**: component patterns for AR/VR interfaces.
- `design-systems/thepunisher-designsystemwearablecomponentexpert.md` — **ThePunisher-DesignSystemWearableComponentExpert**: wearable/smartwatch component patterns.
- `design-systems/thepunisher-designsystemvoiceuicomponentexpert.md` — **ThePunisher-DesignSystemVoiceUIComponentExpert**: voice-interface component patterns.
- `design-systems/thepunisher-designsystemprintexportcomponentexpert.md` — **ThePunisher-DesignSystemPrintExportComponentExpert**: print/PDF-export-aware component engineering.
- `design-systems/thepunisher-designsystemembeddeddisplaycomponentexpert.md` — **ThePunisher-DesignSystemEmbeddedDisplayComponentExpert**: small-embedded-display component patterns.
- `design-systems/thepunisher-designsystemautomotiveinfotainmentcomponentexpert.md` — **ThePunisher-DesignSystemAutomotiveInfotainmentComponentExpert**: CarPlay/Android Auto infotainment component patterns.
- `design-systems/thepunisher-designsystemtokenautomationpipelineexpert.md` — **ThePunisher-DesignSystemTokenAutomationPipelineExpert**: CI-driven design-token sync automation.
- `design-systems/thepunisher-designsystemcrossteamadoptioncoachingexpert.md` — **ThePunisher-DesignSystemCrossTeamAdoptionCoachingExpert**: coaching product teams through design-system adoption.
