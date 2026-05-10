const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing Supabase URL env var. Set SUPABASE_URL (preferred) or NEXT_PUBLIC_SUPABASE_URL"
  );
}

if (!supabasePublishableKey) {
  throw new Error(
    "Missing Supabase key env var. Set SUPABASE_ANON_KEY (preferred) or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

export const supabaseEnv = {
  url: supabaseUrl,
  publishableKey: supabasePublishableKey,
};
