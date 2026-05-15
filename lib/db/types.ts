// Hand-authored equivalent of `npx supabase gen types typescript --local`
// output for the tables introduced by migration `0001_auth_schema.sql`.
//
// NOTE: T008 in the Phase 2 task list calls for this file to be regenerated
// from `supabase gen types` once Docker / the Supabase CLI is available.
// The shape below mirrors the canonical generator output for the two tables
// this feature owns (`public.staff`, `public.audit_log`); when T008 is
// actually run, the diff should be limited to formatting and any auto-added
// scaffolding for other schemas Supabase introduces.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      staff: {
        Row: {
          id: string;
          user_id: string | null;
          display_name: string;
          role: string;
          pin_hash: string | null;
          color_token: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          display_name: string;
          role: string;
          pin_hash?: string | null;
          color_token: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          display_name?: string;
          role?: string;
          pin_hash?: string | null;
          color_token?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedSchema: "auth";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          ts: string;
          actor_user_id: string | null;
          acting_as_staff_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          payload: Json;
        };
        Insert: {
          id?: string;
          ts?: string;
          actor_user_id?: string | null;
          acting_as_staff_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          payload?: Json;
        };
        Update: {
          id?: string;
          ts?: string;
          actor_user_id?: string | null;
          acting_as_staff_id?: string | null;
          action?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_acting_as_staff_id_fkey";
            columns: ["acting_as_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
