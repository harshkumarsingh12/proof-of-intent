/**
 * The dispute the Studio widgets are looking at. The mandate diff and the evidence preview are separate Studio
 * widgets, so each used to keep its own dropdown and changing one left the other (and its PDF) on the old
 * dispute. They share this instead: pick a dispute in either and both follow.
 */
import { useSyncExternalStore } from "react";

let selected: string | undefined;
const listeners = new Set<() => void>();

export const selectedDispute = {
  get: (): string | undefined => selected,
  set(id: string | undefined): void {
    if (id === selected) return;
    selected = id;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** The shared dispute and a setter; `undefined` until someone picks one (widgets then show the first). */
export function useSelectedDispute(): [string | undefined, (id: string) => void] {
  const id = useSyncExternalStore(selectedDispute.subscribe, selectedDispute.get, () => undefined);
  return [id, selectedDispute.set];
}
