# SvelteKit preset invariants

- Type-check the project with svelte-check against its tsconfig. (`check`)
- Verify formatting and lint the whole repository without automatic fixes. (`lint`)
- Build the Node adapter output. (`build`)
- Run the unit suite once, never in watch mode. (`test_unit`)
- Run the browser end-to-end suite at closure. (`test_e2e`)
- Analyze the rendered home page with axe and refuse serious or critical violations. (`accessibility`)
- Refuse unused files, exports and dependencies. (`dead_code`)
- Bound production functions by complexity, length, parameter count and nesting; test files are exempt from function length. (`design_limits`)
- Start the built Node server and require HTTP 200 on the root route. (`smoke`)
- Reject recognized private keys and common credential token formats with explicit rules. (`secrets_scan`)
- Check published dependency advisories, including development dependencies. (`audit`)
- Keep the generated source map synchronized. (`project_map`)

Preset limits are fixed policy, verified against the installed project. They are not measurements copied from another application and are never automatically relaxed. Generic map and security tools are heuristic; architecture semantics and authorization remain review concerns.
