export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_rate_limits: {
        Row: {
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      billing_payment_details: {
        Row: {
          bank_name: string | null
          created_at: string
          crypto_network: string | null
          crypto_wallet: string | null
          display_name: string | null
          iban: string | null
          notes: string | null
          payment_link: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          crypto_network?: string | null
          crypto_wallet?: string | null
          display_name?: string | null
          iban?: string | null
          notes?: string | null
          payment_link?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          crypto_network?: string | null
          crypto_wallet?: string | null
          display_name?: string | null
          iban?: string | null
          notes?: string | null
          payment_link?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      block_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          raw_input: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          raw_input: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          raw_input?: string
          user_id?: string
        }
        Relationships: []
      }
      blocks: {
        Row: {
          actual_minutes: number | null
          ai_reasoning: string | null
          block_type: string
          completed: boolean
          completed_at: string | null
          created_at: string
          duration_min: number
          estimated_minutes: number
          id: string
          is_calendar_event: boolean
          kind: string
          location: string | null
          location_lat: number | null
          location_lng: number | null
          moved_to_date: string | null
          overlap_ok: boolean
          parallel_group_id: string | null
          parallel_with: string | null
          plan_id: string
          position: number
          priority: boolean
          resolution: string | null
          resolved_at: string | null
          slot_end_time: string | null
          source_block_id: string | null
          start_time: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actual_minutes?: number | null
          ai_reasoning?: string | null
          block_type?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          duration_min: number
          estimated_minutes?: number
          id?: string
          is_calendar_event?: boolean
          kind?: string
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          moved_to_date?: string | null
          overlap_ok?: boolean
          parallel_group_id?: string | null
          parallel_with?: string | null
          plan_id: string
          position?: number
          priority?: boolean
          resolution?: string | null
          resolved_at?: string | null
          slot_end_time?: string | null
          source_block_id?: string | null
          start_time: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          actual_minutes?: number | null
          ai_reasoning?: string | null
          block_type?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          duration_min?: number
          estimated_minutes?: number
          id?: string
          is_calendar_event?: boolean
          kind?: string
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          moved_to_date?: string | null
          overlap_ok?: boolean
          parallel_group_id?: string | null
          parallel_with?: string | null
          plan_id?: string
          position?: number
          priority?: boolean
          resolution?: string | null
          resolved_at?: string | null
          slot_end_time?: string | null
          source_block_id?: string | null
          start_time?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_source_block_id_fkey"
            columns: ["source_block_id"]
            isOneToOne: false
            referencedRelation: "blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_tokens: {
        Row: {
          access_token: string | null
          created_at: string
          email: string | null
          expires_at: string | null
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string | null
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checklist_groups: {
        Row: {
          created_at: string
          id: string
          pinned: boolean
          plan_date: string
          position: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pinned?: boolean
          plan_date: string
          position?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pinned?: boolean
          plan_date?: string
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          created_at: string
          done: boolean
          failed: boolean
          group_id: string | null
          id: string
          pinned: boolean
          plan_date: string
          position: number
          priority: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          failed?: boolean
          group_id?: string | null
          id?: string
          pinned?: boolean
          plan_date: string
          position?: number
          priority?: boolean
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          failed?: boolean
          group_id?: string | null
          id?: string
          pinned?: boolean
          plan_date?: string
          position?: number
          priority?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "checklist_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          id: string
          kind: string
          local_date: string
          sent_at: string
          user_id: string
        }
        Insert: {
          id?: string
          kind: string
          local_date: string
          sent_at?: string
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          local_date?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          ai_subtext: string | null
          ai_summary: string | null
          created_at: string
          date: string
          id: string
          raw_input: string
          user_id: string
        }
        Insert: {
          ai_subtext?: string | null
          ai_summary?: string | null
          created_at?: string
          date?: string
          id?: string
          raw_input: string
          user_id: string
        }
        Update: {
          ai_subtext?: string | null
          ai_summary?: string | null
          created_at?: string
          date?: string
          id?: string
          raw_input?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_hours_end: string
          active_hours_start: string
          ai_context_custom: string | null
          ai_personalization_enabled: boolean
          ai_planning_rules: string | null
          ai_tone: string
          ai_tone_custom: string | null
          created_at: string
          digest_opt_in: boolean
          display_name: string | null
          energy_preference: string
          energy_zones: Json | null
          evening_nudge_local_time: string
          id: string
          install_prompted_at: string | null

          morning_nudge_local_time: string
          notifications_enabled: boolean
          onboarded: boolean
          passkey_enabled: boolean
          theme: string
          timezone: string
          tour_seen: Json
          updated_at: string
        }
        Insert: {
          active_hours_end?: string
          active_hours_start?: string
          ai_context_custom?: string | null
          ai_personalization_enabled?: boolean
          ai_planning_rules?: string | null
          ai_tone?: string
          ai_tone_custom?: string | null
          created_at?: string
          digest_opt_in?: boolean
          display_name?: string | null
          energy_preference?: string
          energy_zones?: Json | null
          evening_nudge_local_time?: string
          id: string
          install_prompted_at?: string | null

          morning_nudge_local_time?: string
          notifications_enabled?: boolean
          onboarded?: boolean
          passkey_enabled?: boolean
          theme?: string
          timezone?: string
          tour_seen?: Json
          updated_at?: string
        }
        Update: {
          active_hours_end?: string
          active_hours_start?: string
          ai_context_custom?: string | null
          ai_personalization_enabled?: boolean
          ai_planning_rules?: string | null
          ai_tone?: string
          ai_tone_custom?: string | null
          created_at?: string
          digest_opt_in?: boolean
          display_name?: string | null
          energy_preference?: string
          energy_zones?: Json | null
          evening_nudge_local_time?: string
          id?: string
          install_prompted_at?: string | null

          morning_nudge_local_time?: string
          notifications_enabled?: boolean
          onboarded?: boolean
          passkey_enabled?: boolean
          theme?: string
          timezone?: string
          tour_seen?: Json
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          device_id: string | null
          device_model: string | null
          enabled: boolean
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          device_model?: string | null
          enabled?: boolean
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          device_model?: string | null
          enabled?: boolean
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quick_captures: {
        Row: {
          consumed: boolean
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          consumed?: boolean
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          consumed?: boolean
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      streaks: {
        Row: {
          current_streak: number
          freeze_resets_at: string
          freezes_remaining: number
          last_planned_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          freeze_resets_at?: string
          freezes_remaining?: number
          last_planned_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          freeze_resets_at?: string
          freezes_remaining?: number
          last_planned_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          apple_latest_transaction_id: string | null
          apple_original_transaction_id: string | null
          apple_product_id: string | null
          current_period_end: string | null
          environment: string | null
          last_event_at: string | null
          last_notification_type: string | null
          plan: string | null
          platform: string
          status: string
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apple_latest_transaction_id?: string | null
          apple_original_transaction_id?: string | null
          apple_product_id?: string | null
          current_period_end?: string | null
          environment?: string | null
          last_event_at?: string | null
          last_notification_type?: string | null
          plan?: string | null
          platform?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apple_latest_transaction_id?: string | null
          apple_original_transaction_id?: string | null
          apple_product_id?: string | null
          current_period_end?: string | null
          environment?: string | null
          last_event_at?: string | null
          last_notification_type?: string | null
          plan?: string | null
          platform?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      time_categories: {
        Row: {
          billing_bank_name: string | null
          billing_crypto_network: string | null
          billing_crypto_wallet: string | null
          billing_display_name: string | null
          billing_iban: string | null
          billing_notes: string | null
          billing_payment_link: string | null
          cap_notify_enabled: boolean
          color: string
          created_at: string
          currency: string
          daily_cap_minutes: number | null
          deleted_at: string | null
          hourly_rate: number | null
          id: string
          is_default: boolean
          name: string
          payment_method: string | null
          rate_set_at: string | null
          user_id: string
        }
        Insert: {
          billing_bank_name?: string | null
          billing_crypto_network?: string | null
          billing_crypto_wallet?: string | null
          billing_display_name?: string | null
          billing_iban?: string | null
          billing_notes?: string | null
          billing_payment_link?: string | null
          cap_notify_enabled?: boolean
          color?: string
          created_at?: string
          currency?: string
          daily_cap_minutes?: number | null
          deleted_at?: string | null
          hourly_rate?: number | null
          id?: string
          is_default?: boolean
          name: string
          payment_method?: string | null
          rate_set_at?: string | null
          user_id: string
        }
        Update: {
          billing_bank_name?: string | null
          billing_crypto_network?: string | null
          billing_crypto_wallet?: string | null
          billing_display_name?: string | null
          billing_iban?: string | null
          billing_notes?: string | null
          billing_payment_link?: string | null
          cap_notify_enabled?: boolean
          color?: string
          created_at?: string
          currency?: string
          daily_cap_minutes?: number | null
          deleted_at?: string | null
          hourly_rate?: number | null
          id?: string
          is_default?: boolean
          name?: string
          payment_method?: string | null
          rate_set_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          adjustment_reason: string | null
          adjustment_seconds: number
          block_id: string | null
          category_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          note: string | null
          snapshot_currency: string | null
          snapshot_hourly_rate: number | null
          source: string
          started_at: string
          task_title: string | null
          user_id: string
        }
        Insert: {
          adjustment_reason?: string | null
          adjustment_seconds?: number
          block_id?: string | null
          category_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          note?: string | null
          snapshot_currency?: string | null
          snapshot_hourly_rate?: number | null
          source?: string
          started_at?: string
          task_title?: string | null
          user_id: string
        }
        Update: {
          adjustment_reason?: string | null
          adjustment_seconds?: number
          block_id?: string | null
          category_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          note?: string | null
          snapshot_currency?: string | null
          snapshot_hourly_rate?: number | null
          source?: string
          started_at?: string
          task_title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "time_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_patterns: {
        Row: {
          abandoned_types: Json
          completion_by_hour: Json
          deep_work_overrun_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          abandoned_types?: Json
          completion_by_hour?: Json
          deep_work_overrun_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          abandoned_types?: Json
          completion_by_hour?: Json
          deep_work_overrun_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_ai_rate_limit: {
        Args: { p_max_requests: number; p_window_seconds: number }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
