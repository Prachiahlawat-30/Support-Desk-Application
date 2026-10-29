import { io } from 'socket.io-client';
import { api, tokenStore } from '../api/client.js';
import { createRealtimeClient } from './realtime.js';

// The app's single real-time connection. The JWT is sent in Socket.IO's `auth` handshake
// field (never in the URL) and is read on every (re)connect, so it is always the current one.
export const realtime = createRealtimeClient({
  connect: () =>
    io({
      path: '/socket.io',
      auth: (send) => send({ token: tokenStore.get() }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    }),
  // The server refused or ended the session: check it through the API, which signs the
  // user out on 401 (and stops this connection with it).
  onAuthError: () => {
    api.me().catch(() => {});
  },
});
