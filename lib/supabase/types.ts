// Generated-style Database type for Supabase client. Hand-maintained to
// match supabase/migrations/0001_init.sql exactly. When adding tables,
// update both here and the SQL migration.
//
// Convention: Row = SELECT shape, Insert = INSERT shape (default-able cols
// optional), Update = partial Insert.

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

// ---------- bt_runs ----------
export type BtRunRow = {
  id: string;
  user_address: string;
  created_at: string;
  updated_at: string;
  strategy_ticker: string;
  days: number;
  constituents: Json;
  return_total: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  vs_btc: number | null;
  vs_eth: number | null;
  n_assets: number | null;
  n_returns: number | null;
  equity_preview: Json | null;
  raw_result: Json | null;
  label: string | null;
  notes: string | null;
  tags: string[] | null;
};
export type BtRunInsert = Omit<BtRunRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
export type BtRunUpdate = Partial<BtRunInsert>;

// ---------- bt_share_links ----------
export type BtShareLinkRow = {
  short_code: string;
  run_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  view_count: number;
};
export type BtShareLinkInsert = Omit<
  BtShareLinkRow,
  "short_code" | "created_at" | "view_count"
> & {
  short_code?: string;
  created_at?: string;
  view_count?: number;
};

// ---------- bd_drafts ----------
export type BdDraftRow = {
  id: string;
  user_address: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  sector: string | null;
  n_assets: number | null;
  weighting_rule: string | null;
  constituents: Json | null;
  extra_assets: Json | null;
  meta: Json | null;
  rebalance_triggers: Json | null;
  status: "draft" | "simulated" | "deployed" | "archived";
};
export type BdDraftInsert = Omit<BdDraftRow, "id" | "created_at" | "updated_at" | "status"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  status?: BdDraftRow["status"];
};
export type BdDraftUpdate = Partial<BdDraftInsert>;

// ---------- ch_threads ----------
export type ChThreadRow = {
  id: string;
  user_address: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  archived: boolean;
  pinned: boolean;
};
export type ChThreadInsert = Omit<
  ChThreadRow,
  "id" | "created_at" | "updated_at" | "archived" | "pinned"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  archived?: boolean;
  pinned?: boolean;
};
export type ChThreadUpdate = Partial<ChThreadInsert>;

// ---------- ch_messages ----------
export type ChMessageRow = {
  id: string;
  thread_id: string;
  user_address: string;
  created_at: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: Json | null;
  usage: Json | null;
  seq: number;
};
export type ChMessageInsert = Omit<ChMessageRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

// ---------- pf_snapshots ----------
export type PfSnapshotRow = {
  id: string;
  user_address: string;
  taken_at: string;
  positions: Json;
  total_aum_usd: number | null;
  total_pnl_usd: number | null;
  benchmark_btc_price: number | null;
  benchmark_eth_price: number | null;
  benchmark_ssimag7_nav: number | null;
  trigger: "manual" | "cron_daily" | "cron_hourly" | "event";
};
export type PfSnapshotInsert = Omit<PfSnapshotRow, "id" | "taken_at" | "trigger"> & {
  id?: string;
  taken_at?: string;
  trigger?: PfSnapshotRow["trigger"];
};

// ---------- pb_proposals ----------
export type PbProposalRow = {
  id: string;
  creator_address: string;
  created_at: string;
  updated_at: string;
  ssi_ticker: string;
  title: string | null;
  thesis: string | null;
  constituents: Json;
  meta: Json | null;
  source: "manual" | "agent_draft" | "hype_radar";
  source_run_id: string | null;
  status: "draft" | "review" | "signed" | "published" | "live" | "paused" | "rejected";
  on_chain_tx: string | null;
  on_chain_index_id: string | null;
  backtest_return: number | null;
  backtest_sharpe: number | null;
  backtest_max_dd: number | null;
};
export type PbProposalInsert = Omit<
  PbProposalRow,
  "id" | "created_at" | "updated_at" | "source" | "status"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  source?: PbProposalRow["source"];
  status?: PbProposalRow["status"];
};
export type PbProposalUpdate = Partial<PbProposalInsert>;

// ---------- pb_subscriptions ----------
export type PbSubscriptionRow = {
  id: string;
  proposal_id: string;
  index_id: string;
  subscriber_address: string;
  shares: number;
  status: "active" | "redeemed";
  first_subscribed_at: string;
  updated_at: string;
};
export type PbSubscriptionInsert = Omit<
  PbSubscriptionRow,
  "id" | "first_subscribed_at" | "updated_at" | "status" | "shares"
> & {
  id?: string;
  first_subscribed_at?: string;
  updated_at?: string;
  status?: PbSubscriptionRow["status"];
  shares?: number;
};

// ---------- pb_earnings ----------
export type PbEarningRow = {
  id: string;
  proposal_id: string;
  creator_address: string;
  accrued_at: string;
  event_type: "mgmt_fee" | "perf_fee" | "subscription_fee" | "manual";
  amount_usd: number;
  tx_hash: string | null;
  block_number: number | null;
  aum_usd_at_accrual: number | null;
  subscriber_count: number | null;
};
export type PbEarningInsert = Omit<PbEarningRow, "id" | "accrued_at"> & {
  id?: string;
  accrued_at?: string;
};

// ---------- pt_rebalances ----------
export type PtRebalanceRow = {
  id: string;
  created_at: string;
  sector: string;
  ssi_ticker: string | null;
  creator_address: string | null;
  basket_before: Json | null;
  basket_after: Json | null;
  strategy_source: string | null;
  sentiment_score: number | null;
  risk_verdict: string | null;
  ssi_tx_hash: string | null;
  sodex_placed: number;
  sodex_skipped: number;
  sodex_errors: number;
  emergency: boolean;
};
export type PtRebalanceInsert = Omit<PtRebalanceRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

// ---------- pt_trades ----------
export type PtTradeRow = {
  id: string;
  rebalance_id: string;
  created_at: string;
  symbol: string | null;
  weight: number | null;
  amount_in_usdc: number | null;
  limit_price: string | null;
  last_price: string | null;
  quantity: string | null;
  notional: number | null;
  gas_val: number | null;
  latency_ms: number | null;
  order_id: string | null;
  cl_ord_id: string | null;
  pair: string | null;
  mode: string | null;
  status: string | null;
  error: string | null;
};
export type PtTradeInsert = Omit<PtTradeRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

// ---------- sys_risk_audit ----------
export type SysRiskAuditRow = {
  id: string;
  user_address: string;
  changed_at: string;
  config_before: Json | null;
  config_after: Json | null;
  change_source: string | null;
};
export type SysRiskAuditInsert = Omit<SysRiskAuditRow, "id" | "changed_at"> & {
  id?: string;
  changed_at?: string;
};

// ---------- sys_user_settings ----------
export type SysUserSettingsRow = {
  user_address: string;
  created_at: string;
  updated_at: string;
  theme: string;
  default_period: string;
  default_strategy: string;
  email: string | null;
  notify_on_drawdown: boolean;
  notify_on_rebalance: boolean;
  notify_on_publish: boolean;
  display_name: string | null;
  twitter_handle: string | null;
  bio: string | null;
};
export type SysUserSettingsInsert = Partial<SysUserSettingsRow> & {
  user_address: string;
};
export type SysUserSettingsUpdate = Partial<SysUserSettingsInsert>;

// ---------- Database root ----------
//
// Shape mirrors what `supabase gen types typescript` would emit so postgrest-js's
// `GenericSchema` constraint is satisfied — without this, `db.from(...).insert(...)`
// erases the Insert payload type to `never` and every caller has to `as any` /
// `as never` their inserts. Each table needs an explicit (possibly empty)
// `Relationships` field; the schema needs explicit `Views`, `Functions`, `Enums`,
// and `CompositeTypes` keys even when empty.

type EmptyMap = { [_ in never]: never };

export type Database = {
  public: {
    Tables: {
      bt_runs: {
        Row: BtRunRow;
        Insert: BtRunInsert;
        Update: BtRunUpdate;
        Relationships: [];
      };
      bt_share_links: {
        Row: BtShareLinkRow;
        Insert: BtShareLinkInsert;
        Update: Partial<BtShareLinkInsert>;
        Relationships: [
          {
            foreignKeyName: "bt_share_links_run_id_fkey";
            columns: ["run_id"];
            referencedRelation: "bt_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      bd_drafts: {
        Row: BdDraftRow;
        Insert: BdDraftInsert;
        Update: BdDraftUpdate;
        Relationships: [];
      };
      ch_threads: {
        Row: ChThreadRow;
        Insert: ChThreadInsert;
        Update: ChThreadUpdate;
        Relationships: [];
      };
      ch_messages: {
        Row: ChMessageRow;
        Insert: ChMessageInsert;
        Update: Partial<ChMessageInsert>;
        Relationships: [
          {
            foreignKeyName: "ch_messages_thread_id_fkey";
            columns: ["thread_id"];
            referencedRelation: "ch_threads";
            referencedColumns: ["id"];
          },
        ];
      };
      pf_snapshots: {
        Row: PfSnapshotRow;
        Insert: PfSnapshotInsert;
        Update: Partial<PfSnapshotInsert>;
        Relationships: [];
      };
      pb_proposals: {
        Row: PbProposalRow;
        Insert: PbProposalInsert;
        Update: PbProposalUpdate;
        Relationships: [
          {
            foreignKeyName: "pb_proposals_source_run_id_fkey";
            columns: ["source_run_id"];
            referencedRelation: "bt_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      pb_earnings: {
        Row: PbEarningRow;
        Insert: PbEarningInsert;
        Update: Partial<PbEarningInsert>;
        Relationships: [
          {
            foreignKeyName: "pb_earnings_proposal_id_fkey";
            columns: ["proposal_id"];
            referencedRelation: "pb_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      pb_subscriptions: {
        Row: PbSubscriptionRow;
        Insert: PbSubscriptionInsert;
        Update: Partial<PbSubscriptionInsert>;
        Relationships: [
          {
            foreignKeyName: "pb_subscriptions_proposal_id_fkey";
            columns: ["proposal_id"];
            referencedRelation: "pb_proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      sys_risk_audit: {
        Row: SysRiskAuditRow;
        Insert: SysRiskAuditInsert;
        Update: Partial<SysRiskAuditInsert>;
        Relationships: [];
      };
      sys_user_settings: {
        Row: SysUserSettingsRow;
        Insert: SysUserSettingsInsert;
        Update: SysUserSettingsUpdate;
        Relationships: [];
      };
      pt_rebalances: {
        Row: PtRebalanceRow;
        Insert: PtRebalanceInsert;
        Update: Partial<PtRebalanceInsert>;
        Relationships: [];
      };
      pt_trades: {
        Row: PtTradeRow;
        Insert: PtTradeInsert;
        Update: Partial<PtTradeInsert>;
        Relationships: [
          {
            foreignKeyName: "pt_trades_rebalance_id_fkey";
            columns: ["rebalance_id"];
            referencedRelation: "pt_rebalances";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: EmptyMap;
    Functions: EmptyMap;
    Enums: EmptyMap;
    CompositeTypes: EmptyMap;
  };
};
