"use client";

// Client wrapper for /settings — handles tab switching between Profile,
// Notifications, and Transport. The Transport tab is the original server-
// rendered diagnostics view, passed in as `transportSlot` so the heavy data
// fetching stays on the server.

import { useState, type ReactNode } from "react";

import { Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";

import { ProfileTab } from "./ProfileTab";
import { NotificationsTab } from "./NotificationsTab";

type Tab = "profile" | "transport" | "notifications" | "keys" | "mcp" | "risk" | "billing";

const TABS: Array<{ key: Tab; label: string; ready: boolean }> = [
  { key: "profile", label: "Profile", ready: true },
  { key: "transport", label: "Transport", ready: true },
  { key: "notifications", label: "Notifications", ready: true },
  { key: "keys", label: "Keys & Connections", ready: false },
  { key: "mcp", label: "MCP Tools", ready: false },
  { key: "risk", label: "Risk Defaults", ready: false },
  { key: "billing", label: "Billing", ready: false },
];

export type SettingsClientProps = {
  /** Pre-rendered Transport tab content (heavy data fetched server-side). */
  transportSlot: ReactNode;
};

export function SettingsClient({ transportSlot }: SettingsClientProps) {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div
      className="grid h-[calc(100vh-48px)]"
      style={{ gridTemplateColumns: "220px 1fr" }}
    >
      <div style={{ padding: 16, borderRight: `1px solid ${tokens.border}` }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            marginBottom: 14,
            letterSpacing: "-0.02em",
          }}
        >
          Settings
        </div>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.ready}
              onClick={() => t.ready && setTab(t.key)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: on ? tokens.bgElev : "transparent",
                border: `1px solid ${on ? tokens.border : "transparent"}`,
                borderLeft: on
                  ? `2px solid ${tokens.emerald}`
                  : "2px solid transparent",
                borderRadius: 5,
                marginBottom: 2,
                fontSize: 12.5,
                color: on ? tokens.text : t.ready ? tokens.textDim : tokens.textFaint,
                fontWeight: on ? 600 : 500,
                cursor: t.ready ? "pointer" : "not-allowed",
              }}
            >
              {t.label}
              {!t.ready && (
                <Mono size={9} className="ml-1.5">
                  TBD
                </Mono>
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-y-auto" style={{ padding: 24 }}>
        {tab === "profile" && <ProfileTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "transport" && transportSlot}
      </div>
    </div>
  );
}
