"use client";

import { createContext, useContext } from "react";

type DemoContextValue = {
  isDemo: boolean;
};

const DemoContext = createContext<DemoContextValue>({ isDemo: false });

export function DemoProvider({
  isDemo,
  children,
}: {
  isDemo: boolean;
  children: React.ReactNode;
}) {
  return <DemoContext.Provider value={{ isDemo }}>{children}</DemoContext.Provider>;
}

/**
 * Hook to read the demo-mode flag in any client component that lives under
 * `DemoProvider`. Returns `{ isDemo: false }` when used outside the provider
 * (e.g. in a subtree that doesn't have a provider mounted) so it's safe to
 * call unconditionally — the component just won't enter demo-gated branches.
 */
export function useDemoMode(): DemoContextValue {
  return useContext(DemoContext);
}
