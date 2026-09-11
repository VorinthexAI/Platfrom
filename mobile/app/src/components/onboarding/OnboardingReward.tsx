import { Button } from "@vorinthex/shared/ui/button";
import { GiftIcon } from "@vorinthex/shared/ui/icons-mobile";
import { useEffect } from "react";

import { OnboardingStepLayout } from "@/components/onboarding/OnboardingStepLayout";
import { recordOnboardingEvent } from "@/lib/onboarding-events";

export function OnboardingReward({ onFinished }: { onFinished: () => void }) {
  useEffect(() => { void recordOnboardingEvent("onboarding.reward").catch(() => undefined); }, []);

  return <OnboardingStepLayout
    action={<Button onPress={onFinished} size="md" variant="primary">Next</Button>}
    closeLabel="Close reward introduction"
    description="You have been granted 100 Sparks."
    icon={<GiftIcon size="lg" />}
    onClose={onFinished}
    title="Free sparks"
  />;
}
