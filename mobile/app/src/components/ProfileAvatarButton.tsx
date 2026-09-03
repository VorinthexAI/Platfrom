import { useRouter } from "expo-router";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button } from "@vorinthex/shared/ui/button";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { useAuthStore } from "@/state/auth";
import { profileInitial } from "@/lib/auth-helpers";

type ProfileAvatarButtonProps = Omit<ComponentProps<typeof Button>, "children" | "contentMode" | "iconOnly" | "size" | "variant"> & {
  avatarSize?: number;
};

export function ProfileAvatarButton({ avatarSize = 32, ...props }: ProfileAvatarButtonProps) {
  const user = useAuthStore((state) => state.user);
  return <Button accessibilityLabel="Open profile" contentMode="raw" iconOnly size="md" variant="ghost" {...props}>
    <Avatar fallback={profileInitial(user)} size={avatarSize} style={styles.avatar} uri={user?.avatarUrl} />
  </Button>;
}

export function ProfileHeaderRight() {
  const router = useRouter();
  return <ProfileAvatarButton onPress={() => router.push("/profile")} />;
}

const styles = StyleSheet.create({
  avatar: { borderColor: "#262D36", borderWidth: 1 },
});
