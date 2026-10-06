import { Platform } from "react-native";
import Purchases, { type PurchasesPackage } from "react-native-purchases";

function configuredPublicKey(value?: string) {
  const key = value?.trim() ?? "";
  return key && !key.includes("REPLACE_WITH") ? key : undefined;
}

const apiKey = configuredPublicKey(Platform.OS === "ios" ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY);
let configured = false;
let identifiedUser: string | undefined;

export function purchasesAvailable() { return Boolean(apiKey); }

export async function identifyPurchaser(userKey: string) {
  if (!apiKey || !userKey) throw new Error("In-app purchases are not configured.");
  if (!configured) {
    Purchases.configure({ apiKey, appUserID: userKey });
    configured = true;
    identifiedUser = userKey;
  } else if (identifiedUser !== userKey) {
    await Purchases.logIn(userKey);
    identifiedUser = userKey;
  }
}

export async function availablePackages(userKey: string) {
  await identifyPurchaser(userKey);
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export function packageForProduct(packages: readonly PurchasesPackage[], productId: string) {
  return packages.find((item) => item.product.identifier === productId || item.product.identifier.startsWith(`${productId}:`));
}

export async function purchasePackage(userKey: string, selected: PurchasesPackage) {
  await identifyPurchaser(userKey);
  return Purchases.purchasePackage(selected);
}

export async function restorePurchases(userKey: string) {
  await identifyPurchaser(userKey);
  return Purchases.restorePurchases();
}

export async function manageSubscriptions(userKey: string) {
  await identifyPurchaser(userKey);
  return Purchases.showManageSubscriptions();
}
