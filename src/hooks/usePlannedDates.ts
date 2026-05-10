import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Dates (YYYY-MM-DD) that have at least one saved plan row per user. */
export function usePlannedDates(userId: string | undefined) {
  return useQuery({
    queryKey: ["plan-dates-markers", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("date").eq("user_id", userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r: { date: string }) => r.date));
    },
    staleTime: 60_000,
  });
}
