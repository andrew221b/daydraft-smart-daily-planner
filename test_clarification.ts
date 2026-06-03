import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(url!, key!);
const res = await supabase.functions.invoke("generate-clarification", {
  body: { raw_input: "work on landing page, gym, read book" }
});
console.log(await res.data);
