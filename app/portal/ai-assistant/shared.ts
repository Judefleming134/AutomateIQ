/**
 * Marker prefix for persisted tool-action rows in aa_messages — the chat UI
 * renders these as action chips instead of message bubbles, and the model
 * sees them as an honest record of what it did.
 */
export const ACTION_PREFIX = "⚙ ";

export type AssistantAction = { agent: string; tool: string };
