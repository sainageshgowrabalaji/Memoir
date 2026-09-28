// A tiny "something changed" signal, so a screen refreshes when a reel's page is read in the
// background or a reminder action changes the list, without every screen polling the database.
import { useEffect } from 'react';

type Listener = () => void;
const listeners = new Set<Listener>();

export function dataChanged() {
  for (const listener of listeners) listener();
}

export function useDataChanged(listener: Listener) {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}
