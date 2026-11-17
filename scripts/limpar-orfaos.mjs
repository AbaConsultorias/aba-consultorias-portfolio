// Apaga do Storage os arquivos órfãos (enviados e nunca confirmados, com mais de 24 h).
// Mesma lógica da rota /api/tarefas/limpar-orfaos, para rodar à mão.
// Uso: node --env-file=.env scripts/limpar-orfaos.mjs            (simulação: só lista e conta)
//      node --env-file=.env scripts/limpar-orfaos.mjs --apagar   (apaga de verdade)
import { createClient } from "@supabase/supabase-js";
import { argv, exit } from "node:process";

const BUCKETS = ["site-publico", "documentos", "obras", "fornecedores"];
const IDADE_MINIMA = "24 hours";
const LIMITE_POR_BUCKET = 500;
const TAMANHO_DO_LOTE = 100;

const desconhecidas = argv.slice(2).filter((a) => a !== "--apagar");
if (desconhecidas.length > 0) {
  console.error("Uso: node --env-file=.env scripts/limpar-orfaos.mjs [--apagar]");
  exit(1);
}
const simular = !argv.includes("--apagar");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY no .env.");
  exit(1);
}

const supabase = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(simular ? "Simulação: nada será apagado (use --apagar para apagar).\n" : "Apagando órfãos.\n");

let total = 0;
let falhas = 0;

for (const bucket of BUCKETS) {
  const { data, error } = await supabase.rpc("listar_objetos_orfaos", {
    p_bucket: bucket,
    p_idade: IDADE_MINIMA,
    p_limite: LIMITE_POR_BUCKET,
  });
  if (error) {
    console.error(`${bucket}: não foi possível listar (${error.code ?? error.message}).`);
    falhas += 1;
    continue;
  }

  const nomes = (data ?? []).map((objeto) => objeto.nome);

  if (simular) {
    console.log(`${bucket}: ${nomes.length} órfão(s)`);
    for (const nome of nomes) console.log(`  ${nome}`);
    total += nomes.length;
    continue;
  }

  let removidos = 0;
  for (let i = 0; i < nomes.length; i += TAMANHO_DO_LOTE) {
    const lote = nomes.slice(i, i + TAMANHO_DO_LOTE);
    const { data: apagados, error: erroAoApagar } = await supabase.storage.from(bucket).remove(lote);
    if (erroAoApagar) {
      console.error(`${bucket}: falha ao remover um lote de ${lote.length} (${erroAoApagar.message}).`);
      falhas += lote.length;
      continue;
    }
    removidos += apagados?.length ?? 0;
  }
  console.log(`${bucket}: ${removidos} removido(s) de ${nomes.length}`);
  total += removidos;
}

console.log(`\n${simular ? "Órfãos encontrados" : "Removidos"}: ${total}. Falhas: ${falhas}.`);
if (falhas > 0) exit(1);
