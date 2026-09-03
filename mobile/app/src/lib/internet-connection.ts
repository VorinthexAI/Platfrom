export type InternetConnectionState = {
  isConnected?: boolean;
  isInternetReachable?: boolean;
};

export function isInternetConnectionOffline(state: InternetConnectionState): boolean {
  if (state.isInternetReachable !== undefined) return !state.isInternetReachable;
  return state.isConnected === false;
}
