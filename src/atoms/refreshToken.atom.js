import { atomWithStorage } from 'jotai/utils';

// Stores the encrypted refresh token received after login / OTP verification.
// `null` means no active session.
// getOnInit: it is read outside React (store.get in the 401 handler), where an
// unmounted storage atom would otherwise report null after a page reload and
// the session could never be refreshed.
const refreshToken = atomWithStorage('refreshToken', null, undefined, { getOnInit: true });

export default refreshToken;
