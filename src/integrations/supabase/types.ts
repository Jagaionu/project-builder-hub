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
      admin_credentials: {
        Row: {
          created_at: string
          email: string
          id: string
          password: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          password?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          password?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          plan: string
          slug: string
          subscription_ends_at: string | null
          subscription_status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name: string
          plan?: string
          slug: string
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          plan?: string
          slug?: string
          subscription_ends_at?: string | null
          subscription_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_availability_overrides: {
        Row: {
          available: boolean
          created_at: string
          date: string
          driver_id: string
          id: string
          set_by: string
        }
        Insert: {
          available: boolean
          created_at?: string
          date: string
          driver_id: string
          id?: string
          set_by: string
        }
        Update: {
          available?: boolean
          created_at?: string
          date?: string
          driver_id?: string
          id?: string
          set_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_availability_overrides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_day_hours: {
        Row: {
          actual_driving_minutes: number
          day: string
          deadhead_minutes: number
          drive_minutes: number
          driver_id: string
          id: string
          off_minutes: number
          other_work_minutes: number
          shift_minutes: number
          updated_at: string
          week_start: string | null
        }
        Insert: {
          actual_driving_minutes?: number
          day: string
          deadhead_minutes?: number
          drive_minutes?: number
          driver_id: string
          id?: string
          off_minutes?: number
          other_work_minutes?: number
          shift_minutes?: number
          updated_at?: string
          week_start?: string | null
        }
        Update: {
          actual_driving_minutes?: number
          day?: string
          deadhead_minutes?: number
          drive_minutes?: number
          driver_id?: string
          id?: string
          off_minutes?: number
          other_work_minutes?: number
          shift_minutes?: number
          updated_at?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_day_hours_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_events: {
        Row: {
          driver_id: string
          id: string
          payload: Json
          tenant_id: string | null
          timestamp: string
          type: Database["public"]["Enums"]["driver_event_type"]
        }
        Insert: {
          driver_id: string
          id?: string
          payload?: Json
          tenant_id?: string | null
          timestamp?: string
          type: Database["public"]["Enums"]["driver_event_type"]
        }
        Update: {
          driver_id?: string
          id?: string
          payload?: Json
          tenant_id?: string | null
          timestamp?: string
          type?: Database["public"]["Enums"]["driver_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "driver_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_positions: {
        Row: {
          accuracy: number | null
          bearing: number | null
          created_at: string
          driver_id: string
          id: string
          lat: number
          lon: number
          speed: number | null
        }
        Insert: {
          accuracy?: number | null
          bearing?: number | null
          created_at?: string
          driver_id: string
          id?: string
          lat: number
          lon: number
          speed?: number | null
        }
        Update: {
          accuracy?: number | null
          bearing?: number | null
          created_at?: string
          driver_id?: string
          id?: string
          lat?: number
          lon?: number
          speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_positions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_push_subscriptions: {
        Row: {
          auth: string
          driver_id: string
          endpoint: string
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          driver_id: string
          endpoint: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          driver_id?: string
          endpoint?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_push_subscriptions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_registrations: {
        Row: {
          created_at: string
          driver_id: string | null
          id: string
          name: string | null
          phone: string | null
          status: Database["public"]["Enums"]["registration_status"]
          telegram_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          telegram_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          telegram_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_registrations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_shifts: {
        Row: {
          created_at: string
          days_of_week: number[]
          driver_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[]
          driver_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[]
          driver_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          available_tomorrow: boolean
          created_at: string
          current_lat: number | null
          current_lon: number | null
          home_warehouse_id: string | null
          id: string
          last_update_time: string | null
          login_code: string | null
          name: string
          pairing_code: string | null
          pairing_expires_at: string | null
          phone: string | null
          return_to_base_required: boolean
          status: Database["public"]["Enums"]["driver_status"]
          telegram_id: string | null
          tenant_id: string | null
          tomorrow_start_lat: number | null
          tomorrow_start_lon: number | null
          tomorrow_start_updated_at: string | null
          user_id: string | null
        }
        Insert: {
          available_tomorrow?: boolean
          created_at?: string
          current_lat?: number | null
          current_lon?: number | null
          home_warehouse_id?: string | null
          id?: string
          last_update_time?: string | null
          login_code?: string | null
          name: string
          pairing_code?: string | null
          pairing_expires_at?: string | null
          phone?: string | null
          return_to_base_required?: boolean
          status?: Database["public"]["Enums"]["driver_status"]
          telegram_id?: string | null
          tenant_id?: string | null
          tomorrow_start_lat?: number | null
          tomorrow_start_lon?: number | null
          tomorrow_start_updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          available_tomorrow?: boolean
          created_at?: string
          current_lat?: number | null
          current_lon?: number | null
          home_warehouse_id?: string | null
          id?: string
          last_update_time?: string | null
          login_code?: string | null
          name?: string
          pairing_code?: string | null
          pairing_expires_at?: string | null
          phone?: string | null
          return_to_base_required?: boolean
          status?: Database["public"]["Enums"]["driver_status"]
          telegram_id?: string | null
          tenant_id?: string | null
          tomorrow_start_lat?: number | null
          tomorrow_start_lon?: number | null
          tomorrow_start_updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_home_warehouse_id_fkey"
            columns: ["home_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      driving_legs: {
        Row: {
          arrived_at: string | null
          created_at: string
          departed_at: string | null
          distance_km: number | null
          driver_id: string
          driving_minutes: number | null
          from_label: string | null
          from_lat: number | null
          from_lon: number | null
          from_warehouse_id: string | null
          id: string
          job_id: string | null
          leg_date: string
          planned_minutes: number | null
          source: string
          to_label: string | null
          to_lat: number | null
          to_lon: number | null
          to_warehouse_id: string | null
        }
        Insert: {
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          distance_km?: number | null
          driver_id: string
          driving_minutes?: number | null
          from_label?: string | null
          from_lat?: number | null
          from_lon?: number | null
          from_warehouse_id?: string | null
          id?: string
          job_id?: string | null
          leg_date: string
          planned_minutes?: number | null
          source?: string
          to_label?: string | null
          to_lat?: number | null
          to_lon?: number | null
          to_warehouse_id?: string | null
        }
        Update: {
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          distance_km?: number | null
          driver_id?: string
          driving_minutes?: number | null
          from_label?: string | null
          from_lat?: number | null
          from_lon?: number | null
          from_warehouse_id?: string | null
          id?: string
          job_id?: string | null
          leg_date?: string
          planned_minutes?: number | null
          source?: string
          to_label?: string | null
          to_lat?: number | null
          to_lon?: number | null
          to_warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driving_legs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driving_legs_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driving_legs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driving_legs_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      job_stops: {
        Row: {
          arrived_at: string | null
          created_at: string
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["stop_kind"]
          scheduled_at: string | null
          seq: number
          warehouse_id: string
        }
        Insert: {
          arrived_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["stop_kind"]
          scheduled_at?: string | null
          seq: number
          warehouse_id: string
        }
        Update: {
          arrived_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["stop_kind"]
          scheduled_at?: string | null
          seq?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_stops_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_stops_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assigned_driver_id: string | null
          created_at: string
          destination_warehouse_id: string | null
          equipment_type: string | null
          eta_minutes: number | null
          for_date: string | null
          id: string
          manual_override: boolean
          origin_warehouse_id: string | null
          planned_driver_id: string | null
          planned_sequence: number | null
          planned_start_at: string | null
          reference: string
          scheduled_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_driver_id?: string | null
          created_at?: string
          destination_warehouse_id?: string | null
          equipment_type?: string | null
          eta_minutes?: number | null
          for_date?: string | null
          id?: string
          manual_override?: boolean
          origin_warehouse_id?: string | null
          planned_driver_id?: string | null
          planned_sequence?: number | null
          planned_start_at?: string | null
          reference?: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_driver_id?: string | null
          created_at?: string
          destination_warehouse_id?: string | null
          equipment_type?: string | null
          eta_minutes?: number | null
          for_date?: string | null
          id?: string
          manual_override?: boolean
          origin_warehouse_id?: string | null
          planned_driver_id?: string | null
          planned_sequence?: number | null
          planned_start_at?: string | null
          reference?: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_destination_warehouse_id_fkey"
            columns: ["destination_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_origin_warehouse_id_fkey"
            columns: ["origin_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_planned_driver_id_fkey"
            columns: ["planned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_job_imports: {
        Row: {
          created_at: string
          equipment_type: string | null
          id: string
          lane: string
          missing_codes: string[]
          reference: string
          stop_scheduled_at: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment_type?: string | null
          id?: string
          lane: string
          missing_codes?: string[]
          reference: string
          stop_scheduled_at?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment_type?: string | null
          id?: string
          lane?: string
          missing_codes?: string[]
          reference?: string
          stop_scheduled_at?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stop_dwells: {
        Row: {
          arrived_at: string | null
          created_at: string
          departed_at: string | null
          driver_id: string
          dwell_date: string
          dwell_minutes: number | null
          id: string
          job_id: string | null
          job_stop_id: string | null
          kind: string
          warehouse_id: string | null
        }
        Insert: {
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          driver_id: string
          dwell_date: string
          dwell_minutes?: number | null
          id?: string
          job_id?: string | null
          job_stop_id?: string | null
          kind: string
          warehouse_id?: string | null
        }
        Update: {
          arrived_at?: string | null
          created_at?: string
          departed_at?: string | null
          driver_id?: string
          dwell_date?: string
          dwell_minutes?: number | null
          id?: string
          job_id?: string | null
          job_stop_id?: string | null
          kind?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stop_dwells_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stop_dwells_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stop_dwells_job_stop_id_fkey"
            columns: ["job_stop_id"]
            isOneToOne: false
            referencedRelation: "job_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stop_dwells_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          latitude: number
          longitude: number
          name: string
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          name: string
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_driver_id: { Args: never; Returns: string }
      log_gps: { Args: { points: Json }; Returns: Json }
      current_subscription_status: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      gen_driver_login_code: { Args: never; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      driver_event_type:
        | "START_SHIFT"
        | "LOCATION_UPDATE"
        | "ACCEPT_JOB"
        | "REJECT_JOB"
        | "ARRIVED"
        | "DEPARTED"
        | "DELAY_REPORT"
        | "END_SHIFT"
        | "JOB_CARD_SENT"
        | "CANT_COMPLETE"
        | "END_SHIFT_BLOCKED"
        | "DRIVER_NOTE"
      driver_status:
        | "AVAILABLE"
        | "ON_SHIFT"
        | "ON_ROUTE"
        | "DELAYED"
        | "OFF_SHIFT"
      job_status:
        | "PENDING"
        | "ASSIGNED"
        | "IN_PROGRESS"
        | "ARRIVED_PICKUP"
        | "EN_ROUTE_DELIVERY"
        | "COMPLETED"
        | "CANCELLED"
      registration_status:
        | "AWAITING_NAME"
        | "AWAITING_PHONE"
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
      stop_kind: "PICKUP" | "DROP"
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
    Enums: {
      driver_event_type: [
        "START_SHIFT",
        "LOCATION_UPDATE",
        "ACCEPT_JOB",
        "REJECT_JOB",
        "ARRIVED",
        "DEPARTED",
        "DELAY_REPORT",
        "END_SHIFT",
        "JOB_CARD_SENT",
        "CANT_COMPLETE",
        "END_SHIFT_BLOCKED",
        "DRIVER_NOTE",
      ],
      driver_status: [
        "AVAILABLE",
        "ON_SHIFT",
        "ON_ROUTE",
        "DELAYED",
        "OFF_SHIFT",
      ],
      job_status: [
        "PENDING",
        "ASSIGNED",
        "IN_PROGRESS",
        "ARRIVED_PICKUP",
        "EN_ROUTE_DELIVERY",
        "COMPLETED",
        "CANCELLED",
      ],
      registration_status: [
        "AWAITING_NAME",
        "AWAITING_PHONE",
        "PENDING",
        "APPROVED",
        "REJECTED",
      ],
      stop_kind: ["PICKUP", "DROP"],
    },
  },
} as const
