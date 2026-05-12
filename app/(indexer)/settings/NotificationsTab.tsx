"use client";

// Notifications toggles — three booleans on `sys_user_settings`. Saves
// optimistically: flip the toggle, fire-and-forget PUT, revert on error.

import { useCallback, useEffect, useState } from "react";

import { Card, Label, Mono, Toggle } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { SysUserSettingsRow } from "@/lib/supabase/types";

type NotifKey =
  | "notify_on_drawdown"
  | "notify_on_rebalance"
  | "notify_on_publish";

const ROWS: Array<{ key: NotifKey; label: string; description: string }> = [
  {
    key: "notify_on_drawdown",
    label: "Drawdown breach",
    description:
      "Email me when one of my baskets exceeds the configured drawdown limit.",
  },
  {
    key: "notify_on_rebalance",
    label: "Rebalance executed",
    description: "Notify when the agent rebalances any of my published indices.",
  },
  {
    key: "notify_on_publish",
    label: "Publish confirmed",
    description: "Email me when an on-chain publish transaction confirms.",
  },
];

export function NotificationsTab() {
  const [settings, setSettings] = useState<SysUserSettingsRow | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          if (!cancelled)
            setLoadErr("Sign in to manage your notification preferences.");
          return null;
        }
        if (!r.ok) {
          if (!cancelled) setLoadErr(`HTTP ${r.status}`);
          return null;
        }
        return (await r.json()) as SysUserSettingsRow;
      })
      .then((data) => {
        if (!cancelled && data) setSettings(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (key: NotifKey) => {
      if (!settings) return;
      const next = !settings[key];
      // Optimistic local flip — feels instant.
      setSettings({ ...settings, [key]: next });
      setSaveErr(null);
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [key]: next }),
        });
        if (!res.ok) {
          // Revert on failure so UI stays consistent with server state.
          setSettings({ ...settings });
          const body = await res.json().catch(() => null);
          setSaveErr(body?.error ?? `HTTP ${res.status}`);
        }
      } catch (e) {
        setSettings({ ...settings });
        setSaveErr(e instanceof Error ? e.message : "network error");
      }
    },
    [settings],
  );

  if (loadErr) {
    return (
      <Card pad={20}>
        <div style={{ fontSize: 13, color: tokens.amber, fontWeight: 600 }}>
          {loadErr}
        </div>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card pad={20}>
        <Mono size={11}>Loading preferences…</Mono>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" style={{ maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Notifications
        </div>
        <Mono size={11}>
          email-based alerts · requires an email set in Profile · delivery is{" "}
          <span style={{ color: tokens.amber }}>not yet wired</span> (Wave 3)
        </Mono>
      </div>

      {!settings.email && (
        <Card
          pad={14}
          style={{
            background: tokens.amber + "08",
            borderColor: tokens.amber + "40",
          }}
        >
          <Mono size={11} color={tokens.amber}>
            ⚠ No email on file. Set one in Profile so notifications can reach you.
          </Mono>
        </Card>
      )}

      <Card pad={0}>
        {ROWS.map((row, i) => (
          <div
            key={row.key}
            className="flex justify-between items-start"
            style={{
              padding: "14px 16px",
              borderBottom: i === ROWS.length - 1 ? "none" : `1px solid ${tokens.borderFaint}`,
              gap: 16,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: tokens.text, fontWeight: 600 }}>
                {row.label}
              </div>
              <Mono size={10.5} color={tokens.textDim} className="block mt-1">
                {row.description}
              </Mono>
            </div>
            <Toggle on={!!settings[row.key]} onChange={() => void toggle(row.key)} />
          </div>
        ))}
      </Card>

      {saveErr && (
        <Mono size={11} color={tokens.red}>
          ⚠ {saveErr}
        </Mono>
      )}
    </div>
  );
}
