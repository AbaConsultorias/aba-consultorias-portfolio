import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente para uso em Server Components, Server Actions e API routes.
// Continua usando a publishable key (nunca a secret key aqui) — quem
// decide o que cada usuário pode ver ou alterar é o RLS no banco, não
// este client.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll foi chamado a partir de um Server Component.
            // Pode ser ignorado se o proxy.ts estiver renovando a sessão.
          }
        },
      },
    }
  );
}
