export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      appointments: {
        Row: {
          client_id: string;
          created_at: string;
          created_by_staff_id: string | null;
          created_by_user_id: string | null;
          end_at: string;
          id: string;
          notes: string | null;
          source: string;
          staff_id: string;
          start_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by_staff_id?: string | null;
          created_by_user_id?: string | null;
          end_at: string;
          id?: string;
          notes?: string | null;
          source: string;
          staff_id: string;
          start_at: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by_staff_id?: string | null;
          created_by_user_id?: string | null;
          end_at?: string;
          id?: string;
          notes?: string | null;
          source?: string;
          staff_id?: string;
          start_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_staff_id_fkey";
            columns: ["created_by_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          acting_as_staff_id: string | null;
          action: string;
          actor_user_id: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          payload: Json;
          ts: string;
        };
        Insert: {
          acting_as_staff_id?: string | null;
          action: string;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          payload?: Json;
          ts?: string;
        };
        Update: {
          acting_as_staff_id?: string | null;
          action?: string;
          actor_user_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          payload?: Json;
          ts?: string;
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
      payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["payment_kind"];
          method: Database["public"]["Enums"]["payment_method"];
          processed_at: string;
          status: Database["public"]["Enums"]["payment_status"];
          taken_by_staff_id: string;
          ticket_id: string;
          tip_cents: number;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["payment_kind"];
          method: Database["public"]["Enums"]["payment_method"];
          processed_at?: string;
          status: Database["public"]["Enums"]["payment_status"];
          taken_by_staff_id: string;
          ticket_id: string;
          tip_cents?: number;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["payment_kind"];
          method?: Database["public"]["Enums"]["payment_method"];
          processed_at?: string;
          status?: Database["public"]["Enums"]["payment_status"];
          taken_by_staff_id?: string;
          ticket_id?: string;
          tip_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payments_taken_by_staff_id_fkey";
            columns: ["taken_by_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          active: boolean;
          category: string;
          color_token: string;
          created_at: string;
          duration_min: number;
          id: string;
          name: string;
          presets: Json | null;
          price_cents: number;
          price_from_cents: number | null;
          price_to_cents: number | null;
          taxable: boolean;
          updated_at: string;
          variable_price: boolean;
          variable_price_note: string | null;
        };
        Insert: {
          active?: boolean;
          category?: string;
          color_token: string;
          created_at?: string;
          duration_min: number;
          id?: string;
          name: string;
          presets?: Json | null;
          price_cents: number;
          price_from_cents?: number | null;
          price_to_cents?: number | null;
          taxable?: boolean;
          updated_at?: string;
          variable_price?: boolean;
          variable_price_note?: string | null;
        };
        Update: {
          active?: boolean;
          category?: string;
          color_token?: string;
          created_at?: string;
          duration_min?: number;
          id?: string;
          name?: string;
          presets?: Json | null;
          price_cents?: number;
          price_from_cents?: number | null;
          price_to_cents?: number | null;
          taxable?: boolean;
          updated_at?: string;
          variable_price?: boolean;
          variable_price_note?: string | null;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          active: boolean;
          color_token: string;
          created_at: string;
          display_name: string;
          email: string | null;
          id: string;
          invite_method: string | null;
          invited_at: string | null;
          invited_by: string | null;
          last_sign_in_at: string | null;
          offboard_reason: string | null;
          offboarded_at: string | null;
          offboarded_by: string | null;
          pin_hash: string | null;
          pin_reset_admin_at: string | null;
          removed_at: string | null;
          role: string;
          state: string;
          user_id: string | null;
        };
        Insert: {
          active?: boolean;
          color_token: string;
          created_at?: string;
          display_name: string;
          email?: string | null;
          id?: string;
          invite_method?: string | null;
          invited_at?: string | null;
          invited_by?: string | null;
          last_sign_in_at?: string | null;
          offboard_reason?: string | null;
          offboarded_at?: string | null;
          offboarded_by?: string | null;
          pin_hash?: string | null;
          pin_reset_admin_at?: string | null;
          removed_at?: string | null;
          role: string;
          state?: string;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          color_token?: string;
          created_at?: string;
          display_name?: string;
          email?: string | null;
          id?: string;
          invite_method?: string | null;
          invited_at?: string | null;
          invited_by?: string | null;
          last_sign_in_at?: string | null;
          offboard_reason?: string | null;
          offboarded_at?: string | null;
          offboarded_by?: string | null;
          pin_hash?: string | null;
          pin_reset_admin_at?: string | null;
          removed_at?: string | null;
          role?: string;
          state?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "staff_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_offboarded_by_fkey";
            columns: ["offboarded_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_services: {
        Row: {
          created_at: string;
          duration_min_override: number | null;
          service_id: string;
          staff_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          duration_min_override?: number | null;
          service_id: string;
          staff_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          duration_min_override?: number | null;
          service_id?: string;
          staff_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_services_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_items: {
        Row: {
          assigned_staff_id: string | null;
          created_at: string;
          discount_pct: number | null;
          id: string;
          kind: Database["public"]["Enums"]["ticket_item_kind"];
          name_snapshot: string;
          note: string | null;
          price_unconfirmed: boolean;
          qty: number;
          ref_id: string | null;
          ticket_id: string;
          unit_price_cents: number;
        };
        Insert: {
          assigned_staff_id?: string | null;
          created_at?: string;
          discount_pct?: number | null;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_item_kind"];
          name_snapshot: string;
          note?: string | null;
          price_unconfirmed?: boolean;
          qty?: number;
          ref_id?: string | null;
          ticket_id: string;
          unit_price_cents: number;
        };
        Update: {
          assigned_staff_id?: string | null;
          created_at?: string;
          discount_pct?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_item_kind"];
          name_snapshot?: string;
          note?: string | null;
          price_unconfirmed?: boolean;
          qty?: number;
          ref_id?: string | null;
          ticket_id?: string;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_items_assigned_staff_id_fkey";
            columns: ["assigned_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_items_ref_id_fkey";
            columns: ["ref_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_items_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          appointment_id: string | null;
          closed_at: string | null;
          closed_by_staff_id: string | null;
          created_at: string;
          id: string;
          opened_by_staff_id: string;
          status: Database["public"]["Enums"]["ticket_status"];
          subtotal_cents: number;
          tax_cents: number;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          appointment_id?: string | null;
          closed_at?: string | null;
          closed_by_staff_id?: string | null;
          created_at?: string;
          id?: string;
          opened_by_staff_id: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          subtotal_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          closed_at?: string | null;
          closed_by_staff_id?: string | null;
          created_at?: string;
          id?: string;
          opened_by_staff_id?: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          subtotal_cents?: number;
          tax_cents?: number;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_closed_by_staff_id_fkey";
            columns: ["closed_by_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_opened_by_staff_id_fkey";
            columns: ["opened_by_staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      next_anon_counter: { Args: never; Returns: number };
      pos_take_cash: {
        Args: { p_operator: string; p_ticket_id: string };
        Returns: string;
      };
    };
    Enums: {
      payment_kind: "payment";
      payment_method: "cash";
      payment_status: "succeeded" | "pending" | "failed";
      ticket_item_kind: "service" | "discount";
      ticket_status: "open" | "paid" | "discarded";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      payment_kind: ["payment"],
      payment_method: ["cash"],
      payment_status: ["succeeded", "pending", "failed"],
      ticket_item_kind: ["service", "discount"],
      ticket_status: ["open", "paid", "discarded"],
    },
  },
} as const;
