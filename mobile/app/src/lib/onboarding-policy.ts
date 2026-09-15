export type LocalOnboardingState = {
  complete: boolean;
  introSeen: boolean;
  postDeletion: boolean;
  previewComplete: boolean;
};

export const initialLocalOnboardingState: LocalOnboardingState = { complete: false, introSeen: false, postDeletion: false, previewComplete: false };

export function withIntroSeen(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, introSeen: true, previewComplete: true };
}

export function withPostDeletion(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, introSeen: true, postDeletion: true, previewComplete: false };
}

export function withOnboardingComplete(): LocalOnboardingState {
  return { complete: true, introSeen: true, postDeletion: false, previewComplete: true };
}
