export type LocalOnboardingState = {
  complete: boolean;
  postDeletion: boolean;
  previewComplete: boolean;
  introActive?: boolean;
};

export const initialLocalOnboardingState: LocalOnboardingState = { complete: false, postDeletion: false, previewComplete: false };

export function withPreviewComplete(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, previewComplete: true, introActive: false };
}

export function withPostDeletion(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, postDeletion: true, introActive: false };
}

export function withOnboardingComplete(): LocalOnboardingState {
  return { complete: true, postDeletion: false, previewComplete: true };
}
