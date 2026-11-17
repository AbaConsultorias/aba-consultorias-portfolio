import { LIMITES_PADRAO } from './limites.mjs';
import { rodar } from './programa.mjs';

const MARGEM_VIGIA_MS = 45_000;

const vigia = setTimeout(() => {
  process.stderr.write('Tempo esgotado: encerrando o conector\n');
  process.exit(5);
}, LIMITES_PADRAO.duracaoMs + MARGEM_VIGIA_MS);
vigia.unref();

const codigo = await rodar({ env: process.env, argv: process.argv.slice(2), eco: true });
delete process.env.ABA_CONECTOR_CHAVE;
process.exitCode = codigo;
