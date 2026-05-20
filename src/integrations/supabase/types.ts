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
      driver_events: {
        Row: {
          driver_id: string
          id: string
          payload: Json
          timestamp: string
          type: Database["public"]["Enums"]["driver_event_type"]
        }
        Insert: {
          driver_id: string
          id?: string
          payload?: Json
          timestamp?: string
          type: Database["public"]["Enums"]["driver_event_type"]
        }
        Update: {
          driver_id?: string
          id?: string
          payload?: Json
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
        ]
      }
      drivers: {
        Row: {
          created_at: string
          current_lat: number | null
          current_lon: number | null
          id: string
          last_update_time: string | null
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          telegram_id: string | null
        }
        Insert: {
          created_at?: string
          current_lat?: number | null
          current_lon?: number | null
          id?: string
          last_update_time?: string | null
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          telegram_id?: string | null
        }
        Update: {
          created_at?: string
          current_lat?: number | null
          current_lon?: number | null
          id?: string
          last_update_time?: string | null
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          telegram_id?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          assigned_driver_id: string | null
          created_at: string
          destination_warehouse_id: string
          eta_minutes: number | null
          id: string
          origin_warehouse_id: string
          reference: string
          scheduled_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          assigned_driver_id?: string | null
          created_at?: string
          destination_warehouse_id: string
          eta_minutes?: number | null
          id?: string
          origin_warehouse_id: string
          reference?: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          assigned_driver_id?: string | null
          created_at?: string
          destination_warehouse_id?: string
          eta_minutes?: number | null
          id?: string
          origin_warehouse_id?: string
          reference?: string
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
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
        ]
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
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          name: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          name?: string
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
      driver_event_type:
        | "START_SHIFT"
        | "LOCATION_UPDATE"
        | "ACCEPT_JOB"
        | "REJECT_JOB"
        | "ARRIVED"
        | "DEPARTED"
        | "DELAY_REPORT"
        | "END_SHIFT"
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
    },
  },
} as const
