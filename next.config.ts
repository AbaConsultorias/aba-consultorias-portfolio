import type { NextConfig } from "next";
import { montarCsp } from "./src/lib/seguranca/csp";

function hostDoStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  return new URL(url);
}

const storage = hostDoStorage();
const producao = process.env.NODE_ENV === "production";

const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: montarCsp({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, r2AccountId: process.env.R2_ACCOUNT_ID, producao }),
  },
  // Em desenvolvimento o HSTS ficaria preso no navegador para o localhost.
  ...(producao
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Mantemos só o AGENTS.md (mão própria, sem CLAUDE.md) — desliga o
  // auto-gerenciamento do Next pra ele não recriar CLAUDE.md sozinho.
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
  images: {
    remotePatterns: storage
      ? [
          {
            protocol: storage.protocol === "http:" ? "http" : "https",
            hostname: storage.hostname,
            port: storage.port,
            pathname: "/storage/v1/object/public/site-publico/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
