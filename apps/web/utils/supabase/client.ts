import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "@/utils/supabase/env";

export const createClient = () => createBrowserClient(supabaseEnv.url, supabaseEnv.publishableKey);
