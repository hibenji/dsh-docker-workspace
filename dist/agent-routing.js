/**
 * Return the Agent that owns the current execution.
 *
 * Harness uses `ctx.agents.currentInitiator()` for the asynchronous execution
 * subject. `ctx.agent` is only a static Agent association on an Agent-owned
 * Cordis registration scope, so it is a fallback rather than the primary key.
 */
export function callingAgent(ctx) {
    return ctx.agents.currentInitiator() ?? ctx.agent;
}
/** Synchronous lookup used by SubprocessRuntime.spawn(). */
export function readyWorkspaceForCallingAgent(ctx, ready) {
    const agent = callingAgent(ctx);
    return agent === undefined ? undefined : ready.get(agent.id);
}
//# sourceMappingURL=agent-routing.js.map