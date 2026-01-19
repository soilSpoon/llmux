# Streaming Builders & Normalization

## Context
Streaming builders transform provider-specific stream events into unified events. This process can be complex due to varying event orders and structures across providers.

## Key Learnings
- **Normalization is Critical**: Providers may emit events in unexpected orders (e.g., text before thought end). Always use `normalizeStreamingOrder` to enforce a consistent `thinking_start` -> `thinking_end` -> `text_delta` sequence.
- **State Management**: Builders must maintain internal state (e.g., `StreamingState`) to track thinking/text modes and handle transitions correctly.
- **Event Mapping**: Ensure all provider events map to the correct unified event types.
- **Testing**: Use integration tests that simulate provider streams to verify builder behavior and normalization logic.
