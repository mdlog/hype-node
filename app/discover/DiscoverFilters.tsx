"use client";

// Filter toolbar for /discover. URL-driven so any filter combination is
// shareable / linkable: ?sector=ssiAI&sort=top_return&creator=0xabc.
//
// Sector chips are derived from the actual ssi_ticker values present in the
// loaded proposal set (not a static list) — that way new tickers added by
// publishers show up automatically. Sort + creator search live in the same
// query-param surface so the server component re-renders on change.
//
// Creator search debounces 300ms before pushing into the URL — typing "0x"
// would otherwise blow through History entries one keystroke at a time.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Btn, Mono, Tag } from "@/components/ui";
import { tokens } from "@/lib/tokens";

export type SortKey = "recent" | "top_return" | "top_sharpe" | "low_dd";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "top_return", label: "Top Return" },
  { value: "top_sharpe", label: "Top Sharpe" },
  { value: "low_dd", label: "Lowest Drawdown" },
];

export function DiscoverFilters({
  sectors,
  activeSector,
  activeSort,
  activeCreator,
  totalCount,
}: {
  sectors: string[];
  activeSector: string | null;
  activeSort: SortKey;
  activeCreator: string;
  totalCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Local mirror for the creator input so typing feels instant. We push to
  // the URL on a debounce — useRef so the timeout survives re-renders.
  const [creatorInput, setCreatorInput] = useState(activeCreator);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External URL changes (back button, programmatic nav from another control)
  // should re-sync the input. Local edits already drive the URL via the
  // debounced effect, so this is only for the "outside source" case.
  useEffect(() => {
    setCreatorInput(activeCreator);
  }, [activeCreator]);

  const buildHref = useCallback(
    (overrides: Record<string, string | null>): string => {
      const params = new URLSearchParams(sp?.toString() ?? "");
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [sp, pathname],
  );

  const push = useCallback(
    (overrides: Record<string, string | null>) => {
      router.push(buildHref(overrides), { scroll: false });
    },
    [router, buildHref],
  );

  // Debounced creator-address push. Trim and lowercase so 0x… case variation
  // doesn't fight the prefix match on the server.
  useEffect(() => {
    const next = creatorInput.trim().toLowerCase();
    if (next === activeCreator) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      push({ creator: next || null });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // We intentionally exclude `push` and `activeCreator` to avoid re-arming
    // the timer when the URL update lands; the input value is the only
    // signal we want to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorInput]);

  const sectorList = useMemo(
    () => Array.from(new Set(sectors)).sort((a, b) => a.localeCompare(b)),
    [sectors],
  );

  const inputStyle: React.CSSProperties = {
    background: tokens.bgElev2,
    border: `1px solid ${tokens.border}`,
    color: tokens.text,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "JetBrains Mono, monospace",
    borderRadius: 5,
    width: 320,
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Mono size={10} color={tokens.textFaint} className="mr-1">
          SECTOR
        </Mono>
        <Btn
          small
          primary={!activeSector}
          onClick={() => push({ sector: null })}
        >
          All
        </Btn>
        {sectorList.map((s) => {
          const on = activeSector === s;
          return (
            <Btn
              key={s}
              small
              primary={on}
              onClick={() => push({ sector: on ? null : s })}
            >
              {s}
            </Btn>
          );
        })}
        {sectorList.length === 0 && (
          <Tag small color={tokens.textFaint}>
            no sectors yet
          </Tag>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Mono size={10} color={tokens.textFaint}>
            SORT
          </Mono>
          {SORTS.map((s) => {
            const on = activeSort === s.value;
            return (
              <Btn
                key={s.value}
                small
                primary={on}
                onClick={() => push({ sort: s.value === "recent" ? null : s.value })}
              >
                {s.label}
              </Btn>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Mono size={10} color={tokens.textFaint}>
            CREATOR
          </Mono>
          <input
            style={inputStyle}
            value={creatorInput}
            placeholder="0x… address prefix"
            spellCheck={false}
            onChange={(e) => setCreatorInput(e.target.value)}
          />
          {activeCreator && (
            <Btn small onClick={() => setCreatorInput("")}>
              × Clear
            </Btn>
          )}
        </div>
      </div>

      <Mono size={10} color={tokens.textFaint}>
        {totalCount} indices
        {activeSector ? ` · sector: ${activeSector}` : ""}
        {activeCreator ? ` · creator: ${activeCreator.slice(0, 10)}…` : ""}
        {activeSort !== "recent"
          ? ` · sort: ${SORTS.find((s) => s.value === activeSort)?.label}`
          : ""}
      </Mono>
    </div>
  );
}
