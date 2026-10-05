# Generated artifacts

Source files and numbered SQL migrations are authoritative. `api/[...path].js` remains a tracked deployment artifact: regenerate it with `npm run build` after worker changes and include the resulting bundle with the source change. Never edit it directly.

`dist/`, `.local/`, `test-results/`, Playwright reports, databases, backups, dependency folders and TypeScript build metadata are developer output and remain ignored. Do not commit secrets or database snapshots.

Existing tracked Graphify snapshots are historical review artifacts, not application input. Their presence does not override the ignore rules for newly generated caches/snapshots. Keep existing snapshots for provenance; new ones belong in ignored local output unless intentionally reviewed as a separate documentation change.

`.gitattributes` declares LF for text on every platform and preserves binary assets. Format source with Prettier. A checkout made before the attributes change may need its existing text files normalized to LF without changing their contents.
