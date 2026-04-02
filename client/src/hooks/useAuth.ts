import { useState, useEffect } from "react";
import { api } from "../lib/api";

export interface AuthState {
  authEnabled: boolean;
  authenticated: boolean;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    authEnabled: false,
    authenticated: true,
    loading: true,
  });

  useEffect(() => {
    api.auth
      .status()
      .then(({ enabled, authenticated }) => {
        setState({ authEnabled: enabled, authenticated, loading: false });
      })
      .catch(() => {
        // If status check fails (e.g. 401 from the server itself), treat as enabled+unauthenticated
        setState({ authEnabled: true, authenticated: false, loading: false });
      });
  }, []);

  return state;
}
