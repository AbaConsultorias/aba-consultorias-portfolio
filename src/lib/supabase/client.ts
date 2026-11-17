import { createBrowserClient } from "@supabase/ssr";

// Cliente para uso em Client Components (roda no navegador).
// A URL e a publishable key são públicas por design — a proteção real vem
// do RLS configurado no banco. Veja docs/SECURITY.md antes de criar
// tabelas novas.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
