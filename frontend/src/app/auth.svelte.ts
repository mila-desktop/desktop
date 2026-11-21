import { getWailsMilaBridge } from '../api/bridge';
import { cloudApi, type CloudUser } from '../api/cloud';
import { startCloudUserSync, stopCloudUserSync } from './cloudSync.svelte';
import { resetFriendsState } from './friends.svelte';
import { connectWatchTogether, disconnectWatchTogether } from './watchTogether.svelte';

export interface AuthState {
  user: CloudUser | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

export const auth = $state<AuthState>({
  user: null,
  loading: false,
  initialized: false,
  error: null
});

let initPromise: Promise<void> | null = null;

export async function initAuth(): Promise<void> {
  if (auth.initialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const session = await cloudApi.getSession();
      auth.user = session?.user ?? null;
      auth.error = null;
      if (auth.user) {
        void startCloudUserSync();
        void connectWatchTogether();
      } else {
        stopCloudUserSync();
        void disconnectWatchTogether();
        resetFriendsState();
      }
    } catch (err) {
      auth.error = err instanceof Error ? err.message : 'Failed to load session';
    } finally {
      auth.initialized = true;
      initPromise = null;
    }
  })();
  return initPromise;
}

export async function loginWithGoogle(settleDelayMs = 1400): Promise<CloudUser | null> {
  if (auth.loading) {
    return auth.user;
  }
  if (
    !getWailsMilaBridge()?.CloudLoginWithGoogle &&
    typeof window !== 'undefined' &&
    window.location.port === '5173'
  ) {
    // Redirect from raw Vite dev port (5173) to Wails DevServer (34115) so Go OAuth/cloud bindings are active.
    const nextUrl = `http://localhost:34115${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(nextUrl);
    return null;
  }
  auth.loading = true;
  auth.error = null;
  try {
    const session = await cloudApi.loginWithGoogle();
    if (settleDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
    }
    auth.user = session.user;
    auth.initialized = true;
    void startCloudUserSync();
    void connectWatchTogether();
    return session.user;
  } catch (err) {
    auth.error = err instanceof Error ? err.message : 'Google sign-in failed';
    return null;
  } finally {
    auth.loading = false;
  }
}

export async function logout(): Promise<void> {
  if (auth.loading) {
    return;
  }
  auth.loading = true;
  auth.error = null;
  try {
    stopCloudUserSync();
    await disconnectWatchTogether();
    resetFriendsState();
    await cloudApi.logout();
    auth.user = null;
  } catch (err) {
    auth.error = err instanceof Error ? err.message : 'Sign-out failed';
  } finally {
    auth.loading = false;
  }
}
