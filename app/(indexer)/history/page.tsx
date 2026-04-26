import { Card, Label, Mono, Tag, Btn } from "@/components/ui";
import { tokens } from "@/lib/tokens";

const rows = [
  { t: "09:38:22", a: "Rebalance: +2.1% FIL · −1.4% RNDR", idx: "HDP8", tr: "sentiment Δ +15", g: "0.012 VAL · 4.2s", tx: "0x8a…42", c: tokens.cyan, lbl: "REBAL" },
  { t: "07:14:03", a: "Rebalance: +0.8% AKT · −0.8% IOTX", idx: "HDP8", tr: "flow delta", g: "0.009 VAL · 3.8s", tx: "0x19…a0", c: tokens.cyan, lbl: "REBAL" },
  { t: "04:12:44", a: "Wrap: minted 12,400 HDP8", idx: "HDP8", tr: "user deposit", g: "0.031 VAL · 6.1s", tx: "0x77…bf", c: tokens.emerald, lbl: "WRAP" },
  { t: "00:06:11", a: "Skipped · drift < 1%", idx: "RWA7", tr: "scheduled", g: "—", tx: "—", c: tokens.textFaint, lbl: "SKIP" },
  { t: "yest 22:40", a: "Rebalance: redistributed 5 assets", idx: "RWA7", tr: "scheduled 6h", g: "0.018 VAL · 5.2s", tx: "0x2c…11", c: tokens.cyan, lbl: "REBAL" },
  { t: "yest 18:40", a: "Constituent added: DIMO @ 8%", idx: "HDP8", tr: "agent proposal", g: "0.024 VAL · 4.9s", tx: "0x91…de", c: tokens.emerald, lbl: "ADD" },
  { t: "yest 12:22", a: "Volatility guard: −3% AR", idx: "HDP8", tr: "σ > 0.30", g: "0.014 VAL · 3.6s", tx: "0x55…08", c: tokens.amber, lbl: "GUARD" },
  { t: "2d ago", a: "Emergency exit → USSI", idx: "AIM3", tr: "panic button", g: "0.082 VAL · 11.4s", tx: "0xff…c3", c: tokens.red, lbl: "EXIT" },
  { t: "2d ago", a: "Wrap: minted 2,000 AIM3", idx: "AIM3", tr: "deposit", g: "0.028 VAL · 5.8s", tx: "0x3b…77", c: tokens.emerald, lbl: "WRAP" },
  { t: "3d ago", a: "Rebalance: initial allocation", idx: "AIM3", tr: "launch", g: "0.041 VAL · 7.1s", tx: "0xaa…19", c: tokens.emerald, lbl: "INIT" },
  { t: "3d ago", a: "Rebalance: +1.5% ONDO · −1.5% MKR", idx: "RWA7", tr: "sentiment Δ", g: "0.016 VAL · 4.4s", tx: "0x4d…52", c: tokens.cyan, lbl: "REBAL" },
];

export default function HistoryPage() {
  return (
    <div className="px-6 py-5 flex flex-col gap-3 h-[calc(100vh-48px)]">
      <div className="flex justify-between items-end">
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Rebalancing History</div>
          <Mono size={11}>on-chain audit · 248 transactions · ValueChain L1</Mono>
        </div>
        <div className="flex gap-1.5">
          <Btn small>Filter</Btn>
          <Btn small>Export CSV</Btn>
          <Btn small>Explorer ↗</Btn>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-1.5">
          <Label>Index</Label>
          {["All", "HDP8", "RWA7", "AIM3"].map((t, i) => (
            <Tag key={t} small filled={i === 0} color={i === 0 ? tokens.text : tokens.textDim}>
              {t}
            </Tag>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: tokens.border }} />
        <div className="flex items-center gap-1.5">
          <Label>Type</Label>
          {["All", "Rebalance", "Wrap", "Exit", "Emergency"].map((t, i) => (
            <Tag key={t} small filled={i === 0} color={i === 0 ? tokens.text : tokens.textDim}>
              {t}
            </Tag>
          ))}
        </div>
        <div style={{ width: 1, height: 16, background: tokens.border }} />
        <Tag small>Last 7 days ▾</Tag>
      </div>

      <Card pad={0} className="flex-1 overflow-hidden flex flex-col">
        <div
          className="grid"
          style={{
            gridTemplateColumns: "110px 1fr 100px 160px 110px 100px 60px",
            padding: "10px 16px",
            gap: 12,
            borderBottom: `1px solid ${tokens.border}`,
            background: tokens.bgElev2,
          }}
        >
          {["TIMESTAMP", "ACTION", "INDEX", "TRIGGER", "GAS / LATENCY", "TX", ""].map((k, i) => (
            <Label key={i}>{k}</Label>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid items-center"
              style={{
                gridTemplateColumns: "110px 1fr 100px 160px 110px 100px 60px",
                padding: "10px 16px",
                gap: 12,
                borderBottom: `1px solid ${tokens.borderFaint}`,
              }}
            >
              <Mono size={10}>{r.t}</Mono>
              <div className="flex items-center gap-2">
                <Tag small color={r.c} style={{ minWidth: 48, justifyContent: "center" }}>
                  {r.lbl}
                </Tag>
                <div style={{ fontSize: 12, color: tokens.text }}>{r.a}</div>
              </div>
              <Mono size={11} color={tokens.text}>{r.idx}</Mono>
              <Mono size={10}>{r.tr}</Mono>
              <Mono size={10}>{r.g}</Mono>
              <Mono size={10} color={tokens.cyan}>{r.tx} ↗</Mono>
              <div style={{ textAlign: "right" }}>
                <Mono size={11} color={tokens.textFaint}>→</Mono>
              </div>
            </div>
          ))}
        </div>
        <div
          className="flex justify-between items-center"
          style={{ padding: "10px 16px", borderTop: `1px solid ${tokens.border}`, background: tokens.bgElev2 }}
        >
          <Mono size={10}>showing 11 of 248 · page 1 / 23</Mono>
          <div className="flex gap-1">
            <Btn small>← Prev</Btn>
            <Btn small>Next →</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
