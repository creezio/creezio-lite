export type OnboardingStepId = string;

export type ComputeInitialStepInput = {
  stepCount: number;
  editMode?: boolean;
  startStep?: number;
  persistedStep?: number;
};

export function clampStep(index: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return Math.min(Math.max(index, 0), stepCount - 1);
}

export function computeInitialStep(input: ComputeInitialStepInput): number {
  const last = Math.max(input.stepCount - 1, 0);
  if (input.startStep != null && Number.isFinite(input.startStep)) {
    return clampStep(input.startStep, input.stepCount);
  }
  if (input.editMode) return last;
  return clampStep(input.persistedStep ?? 0, input.stepCount);
}

export function nextStepIndex(current: number, stepCount: number): number {
  return clampStep(current + 1, stepCount);
}

export function prevStepIndex(current: number): number {
  return Math.max(current - 1, 0);
}

export function shouldShowInterstitial(opts: {
  targetIndex: number;
  interstitialsEnabled: boolean;
  hasTitle: boolean;
}): boolean {
  return (
    opts.interstitialsEnabled &&
    opts.hasTitle &&
    opts.targetIndex > 0
  );
}
