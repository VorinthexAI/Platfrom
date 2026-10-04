export type LocalOnboardingState = {
  complete: boolean;
  postDeletion: boolean;
  previewComplete: boolean;
  introActive?: boolean;
  deletionPending?: boolean;
};

export const initialLocalOnboardingState: LocalOnboardingState = { complete: false, postDeletion: false, previewComplete: false };

export function withPreviewComplete(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, previewComplete: true, introActive: false, deletionPending: false };
}

export function withPostDeletion(state: LocalOnboardingState): LocalOnboardingState {
  return { ...state, complete: false, postDeletion: true, previewComplete: false, introActive: false, deletionPending: false };
}

export function withOnboardingComplete(): LocalOnboardingState {
  return { complete: true, postDeletion: false, previewComplete: true };
}
