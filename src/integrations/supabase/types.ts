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
          block_type: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          duration_min: number
          estimated_minutes: number | null
          id: string
          is_calendar_event: boolean
          kind: string
          location: string | null
          location_lat: number | null
          location_lng: number | null
          parallel_with: string | null
          plan_id: string
          position: number
          start_time: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actual_minutes?: number | null
          ai_reasoning?: string | null
          block_type?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          duration_min: number
          estimated_minutes?: number | null
          id?: string
          is_calendar_event?: boolean
          kind?: string
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          parallel_with?: string | null
          plan_id: string
          position?: number
          start_time: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          actual_minutes?: number | null
          ai_reasoning?: string | null
          block_type?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          duration_min?: number
          estimated_minutes?: number | null
          id?: string
          is_calendar_event?: boolean
          kind?: string
          location?: string | null
          location_lat?: number | null
          location_lng?: number | null
          parallel_with?: string | null
          plan_id?: string
          position?: number
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
          color: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          block_id: string | null
          category_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          note: string | null
          source: string
          started_at: string
          user_id: string
        }
        Insert: {
          block_id?: string | null
          category_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          note?: string | null
          source?: string
          started_at?: string
          user_id: string
        }
        Update: {
          block_id?: string | null
          category_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          note?: string | null
          source?: string
          started_at?: string
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
      [_ in never]: never
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
