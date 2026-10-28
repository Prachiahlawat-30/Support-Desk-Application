import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

// The agent list rarely changes, so it is fetched once and shared by all screens.
let agentsPromise;

export function useAgents() {
  const [state, setState] = useState({ agents: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    agentsPromise ??= api.listAgents().then(
      (res) => res.data,
      (err) => {
        agentsPromise = undefined; // allow a retry on the next mount
        throw err;
      },
    );
    agentsPromise.then(
      (agents) => active && setState({ agents, loading: false, error: null }),
      (error) => active && setState({ agents: [], loading: false, error }),
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
