# Nest preset invariants

- Compile the existing TypeScript project without emitting application files. (`check`)
- Apply the project's installed linter to source and tests without automatic fixes. (`lint`)
- Run the existing unit tests without watch mode. (`test_unit`)
- Build with the installed Nest toolchain. (`build`)
- Run the existing HTTP integration suite at closure. (`test_e2e`)
- Start the compiled application and require the configured HTTP status. (`smoke`)
- Bound production functions by complexity, length, parameter count and nesting; test scenario length is exempt. (`design_limits`)
- Reject duplicated significant blocks across source and tests. (`duplication`)
- Reject recognized private keys and common credential token formats in non-ignored repository files. (`secrets_scan`)
- Check published dependency advisories, including development dependencies. (`audit`)
- Keep the generated source and test map synchronized. (`project_map`)

Preset limits are fixed policy, verified against the installed project. They are not measurements copied from another application and are never automatically relaxed. Generic map and security tools are heuristic; architecture semantics and authorization remain review concerns.
