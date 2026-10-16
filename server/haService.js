// The server's Home Assistant mirror wired to the store, the HA settings and the SSE stream (server/index.js starts
// it; the tests start it against a fake Home Assistant). haLive.js holds the logic.
import { getConfig, events as storeEvents } from './store.js';
import * as ha from './homeassistant.js';
import { broadcast } from './sse.js';
import { screenPrivacy } from './privacy.js';
import { startHaLive, stopHaLive, haConfigChanged, haLive, haRestart } from './haLive.js';

let listening = false;

/** Start the mirror (and follow config saves). `opts` overrides deps for tests (timing, WebSocketImpl, coalesceMs). */
export function startHomeAssistantLive(opts = {}) {
  const live = startHaLive({
    getConfig,
    settings: () => ha.haSettings(),
    fetchState: (id) => ha.getState(id),
    broadcast,
    isPrivate: (cfg, screen) => screenPrivacy(cfg, screen).active,
    ...opts,
  });
  ha.setLiveCommand((msg, timeout) => haLive()?.command(msg, timeout));
  if (!listening) {
    listening = true;
    storeEvents.on('config', (cfg, prev) => {
      const h = cfg.homeassistant;
      const p = prev?.homeassistant;
      // a new URL or the integration switched on or off: connect again from scratch
      if (p && (h.url !== p.url || h.enabled !== p.enabled)) {
        ha.invalidateEntityCache();
        haRestart();
      }
      haConfigChanged(cfg);
    });
  }
  return live;
}

export function stopHomeAssistantLive() {
  ha.setLiveCommand(null);
  stopHaLive();
}

/** The token was replaced in the admin. */
export function homeAssistantTokenChanged() {
  ha.invalidateEntityCache();
  haRestart();
}
