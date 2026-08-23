import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderHandlers,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

import { Button, ButtonSizeProvider, type ButtonProps } from "../button/button.mobile";
import { ToastViewport } from "../toast/toast.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors } from "../../tokens";

const BottomSheetSceneContext = createContext<((id: symbol, open: boolean) => void) | null>(
  null,
);

export function BottomSheetScene({ children }: { children: ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  const openSheets = useRef(new Set<symbol>());

  const setSheetOpen = useCallback(
    (id: symbol, open: boolean) => {
      if (open) openSheets.current.add(id);
      else openSheets.current.delete(id);
      const hasOpenSheet = openSheets.current.size > 0;
      progress.stopAnimation();
      Animated.timing(progress, {
        duration: hasOpenSheet ? 320 : 220,
        easing: hasOpenSheet ? Easing.out(Easing.cubic) : Easing.inOut(Easing.cubic),
        toValue: hasOpenSheet ? 1 : 0,
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
  height?: "full";
  hideHeading?: boolean;
  hideCloseButton?: boolean;
  onOpenChange: (open: boolean) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  open: boolean;
  pageKey?: string;
  title: string;
};

type BottomSheetPage = Pick<BottomSheetProps, "children" | "description" | "footer" | "headerLeading" | "headerTrailing" | "hideCloseButton" | "hideHeading" | "pageKey" | "title">;

function SheetSurface({ bottomInset, dismiss, dismissible, dragPanHandlers, fullHeight, inactive = false, page, sheetBottom, style }: { bottomInset: number; dismiss: () => void; dismissible: boolean; dragPanHandlers: GestureResponderHandlers; fullHeight: boolean; inactive?: boolean; page: BottomSheetPage; sheetBottom?: number; style?: StyleProp<ViewStyle> }) {
  return <Animated.View accessibilityElementsHidden={inactive} accessibilityLabel={[page.title, page.description].filter(Boolean).join(". ")} accessibilityRole="summary" collapsable={false} importantForAccessibility={inactive ? "no-hide-descendants" : "auto"} pointerEvents={inactive ? "none" : "auto"} style={[styles.sheet, fullHeight && styles.fullSheet, { bottom: fullHeight ? sheetBottom : undefined, paddingBottom: Platform.OS === "android" ? 16 : Math.max(bottomInset, 16) }, style]}>
    <View style={styles.headerDragTarget}>
      <View collapsable={false} style={styles.dragTarget} {...dragPanHandlers}><View style={styles.dragHandle} /></View>
      <View style={[styles.header, Boolean(page.headerLeading) && !page.hideHeading && styles.headerWithLeading, page.hideHeading && styles.headerWithoutHeading]}>
        {!page.hideHeading ? <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{page.title}</Text> : null}
        {!page.hideHeading && page.description ? <Text style={styles.description}>{page.description}</Text> : null}
      </View>
      {page.headerLeading ? <View style={[styles.headerSlot, styles.headerLeading]}>{page.headerLeading}</View> : null}
      {page.headerTrailing ? <View style={[styles.headerSlot, styles.headerTrailing]}>{page.headerTrailing}</View> : null}
      {!page.hideCloseButton && !page.headerTrailing ? <Button accessibilityLabel="Close bottom sheet" contentMode="raw" disabled={!dismissible} onPress={dismiss} size="md" style={styles.closeButton} variant="icon"><CloseIcon size="sm" /></Button> : null}
    </View>
    <View style={[styles.content, fullHeight && styles.flexContent]}>{page.children}</View>
    {page.footer ? <View style={styles.footer}>{page.footer}</View> : null}
  </Animated.View>;
}

export function BottomSheet({
  children,
  description,
  dismissible = true,
  footer,
  headerLeading,
  headerTrailing,
  height,
  hideHeading = false,
  hideCloseButton = false,
  onOpenChange,
  onSwipeLeft,
  onSwipeRight,
  open,
  pageKey,
  title,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const androidBottomInset = Platform.OS === "android" ? insets.bottom : 0;
  const fullHeight = height === "full";
  const setSceneSheetOpen = useContext(BottomSheetSceneContext);
  const sceneSheetId = useRef(Symbol("bottom-sheet")).current;
  const [visible, setVisible] = useState(open);
  const [reducedMotion, setReducedMotion] = useState(false);
  const closedOffsetRef = useRef(windowHeight + 64);
  closedOffsetRef.current = windowHeight + 64;
  const translateY = useRef(new Animated.Value(closedOffsetRef.current)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  const dismissibleRef = useRef(dismissible);
  const reducedMotionRef = useRef(reducedMotion);
  const dismissingRef = useRef(false);
  const pageWasOpenRef = useRef(open);
  const pageDirectionRef = useRef<1 | -1>(1);
  const pageTranslateX = useRef(new Animated.Value(0)).current;
  const livePage = { children, description, footer, headerLeading, headerTrailing, hideCloseButton, hideHeading, pageKey, title };
  const pageSnapshotRef = useRef<BottomSheetPage>(livePage);
  const [pageTransition, setPageTransition] = useState<{ pageKey: string; previous: BottomSheetPage }>();
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;
  onSwipeLeftRef.current = onSwipeLeft;
  onSwipeRightRef.current = onSwipeRight;
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
    if (!open) return;
    setSceneSheetOpen?.(sceneSheetId, true);
    return () => setSceneSheetOpen?.(sceneSheetId, false);
  }, [open, sceneSheetId, setSceneSheetOpen]);

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
      onStartShouldSetPanResponder: () => false,
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

  const navigateHorizontal = (direction: 1 | -1) => {
    pageDirectionRef.current = direction;
    if (direction === 1) onSwipeLeftRef.current?.();
    else onSwipeRightRef.current?.();
  };

  const horizontalSwipeGesture = Gesture.Pan()
    .enabled(Boolean(onSwipeLeft || onSwipeRight))
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onEnd(({ translationX, velocityX }) => {
      "worklet";
      if (Math.abs(translationX) < 42 && Math.abs(velocityX) < 350) return;
      scheduleOnRN(navigateHorizontal, translationX < 0 ? 1 : -1);
    });

  useLayoutEffect(() => {
    const wasOpen = pageWasOpenRef.current;
    pageWasOpenRef.current = open;
    if (!open || !wasOpen || pageKey === undefined) {
      pageSnapshotRef.current = livePage;
      pageTranslateX.setValue(0);
      if (pageTransition) setPageTransition(undefined);
      return;
    }
    if (pageSnapshotRef.current.pageKey === pageKey) {
      pageSnapshotRef.current = livePage;
      return;
    }
    const previous = pageSnapshotRef.current;
    pageSnapshotRef.current = livePage;
    pageTranslateX.stopAnimation();
    pageTranslateX.setValue(reducedMotionRef.current ? 0 : pageDirectionRef.current * windowWidth);
    if (reducedMotionRef.current) {
      setPageTransition({ pageKey, previous });
      requestAnimationFrame(() => setPageTransition((current) => current?.pageKey === pageKey ? undefined : current));
      return;
    }
    setPageTransition({ pageKey, previous });
    requestAnimationFrame(() => Animated.timing(pageTranslateX, { duration: 280, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: false }).start(({ finished }) => {
      if (finished) setPageTransition((current) => current?.pageKey === pageKey ? undefined : current);
    }));
  });

  if (!visible) return null;
  const transitioningPage = pageKey !== undefined && pageTransition?.pageKey === pageKey;
  const awaitingPageTransition = pageKey !== undefined && pageSnapshotRef.current.pageKey !== pageKey && !transitioningPage;
  const presentedPage = awaitingPageTransition ? pageSnapshotRef.current : livePage;

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
      <GestureHandlerRootView style={styles.root}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={[styles.root, { paddingBottom: androidBottomInset }]}>
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
          <ButtonSizeProvider size="md">
            {pageKey !== undefined && fullHeight ? <GestureDetector gesture={horizontalSwipeGesture}><Animated.View style={[styles.layerHost, { bottom: androidBottomInset, top: insets.top, transform: [{ translateY }] }]}>
              {transitioningPage && pageTransition && pageTransition.previous.pageKey !== presentedPage.pageKey ? <SheetSurface key={pageTransition.previous.pageKey} bottomInset={insets.bottom} dismiss={dismiss} dismissible={dismissible} dragPanHandlers={panResponder.panHandlers} fullHeight inactive page={pageTransition.previous} sheetBottom={0} style={[styles.layerSurface, styles.underLayer]} /> : null}
              <SheetSurface key={presentedPage.pageKey} bottomInset={insets.bottom} dismiss={dismiss} dismissible={dismissible} dragPanHandlers={panResponder.panHandlers} fullHeight page={presentedPage} sheetBottom={0} style={[styles.layerSurface, transitioningPage && { transform: [{ translateX: pageTranslateX }] }]} />
            </Animated.View></GestureDetector> : <SheetSurface bottomInset={insets.bottom} dismiss={dismiss} dismissible={dismissible} dragPanHandlers={panResponder.panHandlers} fullHeight={fullHeight} page={livePage} sheetBottom={androidBottomInset} style={{ top: fullHeight ? insets.top : undefined, transform: [{ translateY }] }} />}
          </ButtonSizeProvider>
        </KeyboardAvoidingView>
        <ToastViewport />
      </GestureHandlerRootView>
    </Modal>
  );
}

export type BottomSheetItemProps = Omit<ButtonProps, "size">;

export function BottomSheetItem({
  style,
  variant = "secondary",
  ...props
}: BottomSheetItemProps) {
  return (
    <Button
      size="md"
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
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: "90%",
    paddingHorizontal: 20,
  },
  fullSheet: {
    bottom: 0,
    left: 0,
    maxHeight: "100%",
    position: "absolute",
    right: 0,
  },
  layerHost: { left: 0, overflow: "hidden", position: "absolute", right: 0 },
  layerSurface: { bottom: 0, top: 0 },
  underLayer: { zIndex: 0 },
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
