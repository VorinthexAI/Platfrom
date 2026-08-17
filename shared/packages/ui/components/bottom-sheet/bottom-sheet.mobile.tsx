import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, type ButtonProps } from "../button/button.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors } from "../../tokens";

const BottomSheetSceneContext = createContext<((open: boolean) => void) | null>(
  null,
);

export function BottomSheetScene({ children }: { children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;

  const setSheetOpen = useCallback(
    (open: boolean) => {
      progress.stopAnimation();
      Animated.timing(progress, {
        duration: open ? 320 : 220,
        easing: open ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
        toValue: open ? 1 : 0,
        useNativeDriver: true,
      }).start();
    },
    [progress],
  );

  return (
    <BottomSheetSceneContext.Provider value={setSheetOpen}>
      <Animated.View
        style={[
          styles.scene,
          {
            transform: [
              { perspective: 1200 },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.94],
                }),
              },
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -8],
                }),
              },
              {
                rotateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "1deg"],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </BottomSheetSceneContext.Provider>
  );
}

export type BottomSheetProps = {
  children?: ReactNode;
  description?: string;
  dismissible?: boolean;
  footer?: ReactNode;
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  hideHeading?: boolean;
  hideCloseButton?: boolean;
  mutation?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tall?: boolean;
  title: string;
};

export function BottomSheet({
  children,
  description,
  dismissible = true,
  footer,
  headerLeading,
  headerTrailing,
  hideHeading = false,
  hideCloseButton = false,
  mutation = false,
  onOpenChange,
  open,
  tall = false,
  title,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const androidBottomInset = Platform.OS === "android" ? Math.max(insets.bottom, 12) : 0;
  const setSceneSheetOpen = useContext(BottomSheetSceneContext);
  const [visible, setVisible] = useState(open);
  const [reducedMotion, setReducedMotion] = useState(false);
  const closedOffsetRef = useRef(windowHeight + 64);
  closedOffsetRef.current = windowHeight + 64;
  const translateY = useRef(new Animated.Value(closedOffsetRef.current)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const dismissibleRef = useRef(dismissible);
  const reducedMotionRef = useRef(reducedMotion);
  const dismissingRef = useRef(false);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;
  dismissibleRef.current = dismissible;
  reducedMotionRef.current = reducedMotion;

  const animate = (show: boolean) => {
    translateY.stopAnimation();
    overlayOpacity.stopAnimation();
    const duration = reducedMotionRef.current ? 0 : show ? 320 : 220;
    Animated.parallel([
      Animated.timing(translateY, {
        duration,
        easing: show ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        toValue: show ? 0 : closedOffsetRef.current,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        duration,
        easing: Easing.linear,
        toValue: show ? 1 : 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !show && !openRef.current) setVisible(false);
    });
  };

  const dismiss = () => {
    if (!dismissibleRef.current || dismissingRef.current) return;
    dismissingRef.current = true;
    openRef.current = false;
    animate(false);
    onOpenChangeRef.current(false);
  };

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setSceneSheetOpen?.(open);
    return () => setSceneSheetOpen?.(false);
  }, [open, setSceneSheetOpen]);

  useEffect(() => {
    if (open) {
      dismissingRef.current = false;
      setVisible(true);
      translateY.setValue(reducedMotionRef.current ? 0 : closedOffsetRef.current);
      overlayOpacity.setValue(reducedMotionRef.current ? 1 : 0);
      animate(true);
    } else if (visible && !dismissingRef.current) {
      animate(false);
    }
    // Animated values are stable refs; visibility is intentionally driven by open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => dismissibleRef.current,
      onMoveShouldSetPanResponder: (_, gesture) =>
        dismissibleRef.current && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        dismissibleRef.current && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
      onPanResponderGrant: () => {
        translateY.stopAnimation();
        overlayOpacity.stopAnimation();
      },
      onPanResponderMove: (_, gesture) => {
        const distance = Math.max(0, gesture.dy);
        translateY.setValue(distance);
        overlayOpacity.setValue(Math.max(0, 1 - distance / 420));
      },
      onPanResponderRelease: (_, gesture) => {
        const projectedDistance = gesture.dy + Math.max(0, gesture.vy) * 140;
        if (dismissibleRef.current && projectedDistance >= 88) {
          dismiss();
        } else {
          animate(true);
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => animate(true),
    }),
  ).current;

  if (!visible) return null;

  return (
    <Modal
      accessibilityViewIsModal
      animationType="none"
      navigationBarTranslucent={false}
      onRequestClose={dismiss}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={[styles.root, { paddingBottom: androidBottomInset }]}>
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <Button
            accessibilityLabel="Close bottom sheet"
            contentMode="raw"
            disabled={!dismissible}
            onPress={dismiss}
            style={StyleSheet.absoluteFill}
            variant="ghost"
          />
        </Animated.View>
        <Animated.View
          accessibilityLabel={[title, description].filter(Boolean).join(". ")}
          accessibilityRole="summary"
          style={[
            styles.sheet,
            tall && styles.tallSheet,
            mutation && styles.mutationSheet,
            Platform.OS === "android" && styles.androidSheet,
            {
              top: mutation ? insets.top : undefined,
              paddingBottom: Platform.OS === "android" ? 16 : Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.headerDragTarget}>
            <View collapsable={false} style={styles.dragTarget} {...panResponder.panHandlers}>
              <View style={styles.dragHandle} />
            </View>
            <View style={[styles.header, Boolean(headerLeading) && !hideHeading && styles.headerWithLeading, hideHeading && styles.headerWithoutHeading]}>
              {!hideHeading ? <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text> : null}
              {!hideHeading && description ? <Text style={styles.description}>{description}</Text> : null}
            </View>
            {headerLeading ? <View style={[styles.headerSlot, styles.headerLeading]}>{headerLeading}</View> : null}
            {headerTrailing ? <View style={[styles.headerSlot, styles.headerTrailing]}>{headerTrailing}</View> : null}
            {!hideCloseButton && !headerTrailing ? <Button
              accessibilityLabel="Close bottom sheet"
              contentMode="raw"
              disabled={!dismissible}
              onPress={dismiss}
              size="sm"
              style={styles.closeButton}
              variant="icon"
            >
              <CloseIcon size="sm" />
            </Button> : null}
          </View>
          <View style={[styles.content, (tall || mutation) && styles.flexContent]}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

export type BottomSheetItemProps = ButtonProps;

export function BottomSheetItem({
  size = "lg",
  style,
  variant = "secondary",
  ...props
}: BottomSheetItemProps) {
  return (
    <Button
      size={size}
      style={(state) => [
        styles.item,
        typeof style === "function" ? style(state) : style,
      ]}
      variant={variant}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
  root: { flex: 1, justifyContent: "flex-end" },
  overlay: {
    backgroundColor: "rgba(3, 5, 7, 0.72)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: colors.page,
    borderColor: "rgba(221, 226, 229, 0.14)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: "90%",
    paddingHorizontal: 20,
  },
  androidSheet: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  tallSheet: { height: "72%" },
  mutationSheet: {
    bottom: 0,
    left: 0,
    maxHeight: "100%",
    position: "absolute",
    right: 0,
  },
  headerDragTarget: { marginHorizontal: -20, paddingHorizontal: 20 },
  dragTarget: { alignItems: "center", minHeight: 36, paddingBottom: 14, paddingTop: 12 },
  dragHandle: {
    backgroundColor: "#7B858C",
    borderRadius: 999,
    height: 4,
    opacity: 0.75,
    width: 42,
  },
  header: { gap: 6, paddingBottom: 18, paddingHorizontal: 4, paddingRight: 48 },
  headerWithLeading: { paddingLeft: 68 },
  headerWithoutHeading: { minHeight: 42 },
  closeButton: { position: "absolute", right: 20, top: 20, zIndex: 1 },
  headerSlot: { position: "absolute", top: 20, zIndex: 1 },
  headerLeading: { left: 20 },
  headerTrailing: { right: 20 },
  title: {
    color: "#F5F7F8",
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 26,
  },
  description: {
    color: "#7B858C",
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  content: { gap: 6 },
  flexContent: { flex: 1 },
  footer: { gap: 8, marginHorizontal: -20, paddingHorizontal: 22, paddingBottom: 2, paddingTop: 18, backgroundColor: colors.page },
  item: { justifyContent: "flex-start", width: "100%" },
});
