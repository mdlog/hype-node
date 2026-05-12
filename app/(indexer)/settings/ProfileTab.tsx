"use client";

// Profile editor — display name, twitter handle, bio, email. Persists to
// `sys_user_settings` via /api/settings. Auto-loads on mount, save button
// enabled only when there are unsaved changes.

import { useCallback, useEffect, useState } from "react";

import { Btn, Card, Label, Mono } from "@/components/ui";
import { tokens } from "@/lib/tokens";
import type { SysUserSettingsRow } from "@/lib/supabase/types";

type SaveState = "idle" | "saving" | "saved" | "error";

const FIELDS: Array<{
  key: keyof Pick<
    SysUserSettingsRow,
    "display_name" | "twitter_handle" | "bio" | "email"
  >;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "display_name", label: "Display name", placeholder: "Anon Trader" },
  {
    key: "twitter_handle",
    label: "Twitter / X handle",
    placeholder: "vitalikbuterin (no @)",
  },
  { key: "email", label: "Email (notifications)", placeholder: "you@example.com" },
  {
    key: "bio",
    label: "Bio",
    placeholder: "Quant. DePIN maxi. NFA.",
    multiline: true,
  },
];

export function ProfileTab() {
  const [original, setOriginal] = useState<SysUserSettingsRow | null>(null);
  const [draft, setDraft] = useState<Partial<SysUserSettingsRow>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Load on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          if (!cancelled) setLoadErr("Sign in to edit your profile.");
          return null;
        }
        if (!r.ok) {
          if (!cancelled) setLoadErr(`HTTP ${r.status}`);
          return null;
        }
        return (await r.json()) as SysUserSettingsRow;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setOriginal(data);
        setDraft({
          display_name: data.display_name,
          twitter_handle: data.twitter_handle,
          bio: data.bio,
          email: data.email,
        });
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    original !== null &&
    FIELDS.some(
      (f) => (draft[f.key] ?? null) !== (original[f.key] ?? null),
    );

  const onSave = useCallback(async () => {
    if (!dirty) return;
    setSaveState("saving");
    setSaveErr(null);
    // Send only the fields that changed.
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const next = draft[f.key];
      if ((next ?? null) !== (original?.[f.key] ?? null)) {
        // Empty string → null so clearing a field actually clears it server-side.
        patch[f.key] =
          typeof next === "string" && next.trim() === "" ? null : next;
      }
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveErr(body?.error ?? `HTTP ${res.status}`);
        setSaveState("error");
        return;
      }
      const updated = (await res.json()) as SysUserSettingsRow;
      setOriginal(updated);
      setDraft({
        display_name: updated.display_name,
        twitter_handle: updated.twitter_handle,
        bio: updated.bio,
        email: updated.email,
      });
      setSaveState("saved");
      // Reset "saved" pill after a moment so the next dirty edit shows clean state.
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "network error");
      setSaveState("error");
    }
  }, [dirty, draft, original]);

  if (loadErr) {
    return (
      <Card pad={20}>
        <div style={{ fontSize: 13, color: tokens.amber, fontWeight: 600 }}>
          {loadErr}
        </div>
      </Card>
    );
  }

  if (!original) {
    return (
      <Card pad={20}>
        <Mono size={11}>Loading profile…</Mono>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" style={{ maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Profile
        </div>
        <Mono size={11}>
          public-facing display info · stored per-wallet in `sys_user_settings`
        </Mono>
      </div>

      <Card pad={20}>
        <div className="flex flex-col gap-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label>{f.label.toUpperCase()}</Label>
              {f.multiline ? (
                <textarea
                  value={(draft[f.key] as string) ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                  rows={3}
                  style={{
                    width: "100%",
                    background: tokens.bgElev,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                    padding: "8px 10px",
                    fontSize: 12.5,
                    color: tokens.text,
                    outline: "none",
                    marginTop: 4,
                    resize: "vertical",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <input
                  type={f.key === "email" ? "email" : "text"}
                  value={(draft[f.key] as string) ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                  style={{
                    width: "100%",
                    height: 32,
                    background: tokens.bgElev,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 5,
                    padding: "0 10px",
                    fontSize: 12.5,
                    color: tokens.text,
                    outline: "none",
                    marginTop: 4,
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Btn primary onClick={onSave} disabled={!dirty || saveState === "saving"}>
          {saveState === "saving" ? "Saving…" : "Save changes"}
        </Btn>
        {saveState === "saved" && (
          <Mono size={11} color={tokens.emerald}>
            ✓ saved
          </Mono>
        )}
        {saveState === "error" && saveErr && (
          <Mono size={11} color={tokens.red}>
            ⚠ {saveErr}
          </Mono>
        )}
        {dirty && saveState === "idle" && (
          <Mono size={11} color={tokens.textFaint}>
            unsaved changes
          </Mono>
        )}
      </div>
    </div>
  );
}
