export const NVIDIA_DEFAULT_AGENT_MODEL = "minimaxai/minimax-m2.7";

export const NVIDIA_AGENT_MODELS = [
  { value: NVIDIA_DEFAULT_AGENT_MODEL, label: "MiniMax M2.7（默认，Agent 实测可用）" },
] as const;

const NVIDIA_AGENT_MODEL_VALUES = new Set<string>(NVIDIA_AGENT_MODELS.map((item) => item.value));

export function isSupportedNvidiaAgentModel(value: string): boolean {
  return NVIDIA_AGENT_MODEL_VALUES.has(value.trim());
}
