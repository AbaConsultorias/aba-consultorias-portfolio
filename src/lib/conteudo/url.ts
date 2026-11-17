const BUCKET_PUBLICO = "site-publico";

export function urlPublica(path: string): string;
export function urlPublica(path: string | null): string | null;
export function urlPublica(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  return `${base}/storage/v1/object/public/${BUCKET_PUBLICO}/${path}`;
}
