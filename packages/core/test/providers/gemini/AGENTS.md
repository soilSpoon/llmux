# Fix: Gemini Streaming Tests & ESM Imports

- **Context**: The `collectStreamChunks` helper used `require` to dynamically import `getFormat` from `src/formats/base`. This failed in the Bun test environment because `getFormat` is exported from `src/formats/registry`, not `base`, and `require` interacts poorly with ESM barrel exports.
- **Fix**: Replaced dynamic `require` with static ESM `import { getFormat } from '../../../src/formats/registry'`.
- **Lesson**: Avoid mixing `require` and `import` in the test suite. Prefer static imports for internal modules. Ensure imports point to the correct source file or a properly working barrel file.
