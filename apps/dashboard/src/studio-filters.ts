/**
 * Tells the custom widgets when Studio's filters or cross filter changed. Studio re-queries its own widgets, but a
 * custom widget only runs `getData` when it asks, and it gets no event for a cross filter (clicking the donut filtered
 * the KPI tiles and left the grid and platform cards showing everything). The Studio view publishes a revision from
 * `onStateUpdated`, and the widgets reload when it changes.
 */
import { useSyncExternalStore } from "react";

interface PageLike {
  id: string;
  filter?: unknown;
  crossFilter?: unknown;
}
interface StateLike {
  selectedPageId: string;
  pages: PageLike[];
}

let revision = 0;
let signature = "";
const listeners = new Set<() => void>();

/** The part of the report state that changes what a widget's query returns: the current page's filters. */
export const filterSignature = (state: StateLike): string => {
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  return JSON.stringify([page?.filter ?? null, page?.crossFilter ?? null]);
};

/** Call with every state update; bumps the revision only when the filters actually changed. */
export function publishState(state: StateLike): boolean {
  const next = filterSignature(state);
  if (next === signature) return false;
  signature = next;
  revision++;
  for (const listener of [...listeners]) listener();
  return true;
}

export const filterRevision = {
  get: (): number => revision,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

let unfilteredTotal: number | undefined;

/** How many disputes the report has before any filter. The platform cards say when a filter has narrowed what they count. */
export function setUnfilteredTotal(total: number): void {
  unfilteredTotal = total;
}

export const getUnfilteredTotal = (): number | undefined => unfilteredTotal;

/** A number that changes whenever Studio's filters do: put it in a widget's data-loading effect. */
export function useFilterRevision(): number {
  return useSyncExternalStore(filterRevision.subscribe, filterRevision.get, () => 0);
}
