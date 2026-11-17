import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FUNDO = "#f5f7f8";
const PROPORCAO_DA_LOGO = 1131 / 1391;

async function logoEmDataUri() {
  const arquivo = await readFile(join(process.cwd(), "public", "marca", "aba-logo.png"));
  return `data:image/png;base64,${arquivo.toString("base64")}`;
}

// Satori (next/og) só desenha <img>, não o componente Image do Next.
/* eslint-disable @next/next/no-img-element */
export async function iconeDaMarca(lado: number) {
  const altura = Math.round(lado * 0.86);
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: FUNDO }}>
      <img src={await logoEmDataUri()} alt="" height={altura} width={Math.round(altura * PROPORCAO_DA_LOGO)} />
    </div>
  );
}

export async function cartaoDaMarca() {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 72, background: FUNDO }}>
      <img src={await logoEmDataUri()} alt="" height={520} width={Math.round(520 * PROPORCAO_DA_LOGO)} />
      <div style={{ display: "flex", flexDirection: "column", width: 560, color: "#1c2832" }}>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>Projetos e regularização de loteamentos</div>
        <div style={{ marginTop: 28, fontSize: 32, color: "#2b7090" }}>Água, esgoto e projetos para a sua casa</div>
      </div>
    </div>
  );
}
/* eslint-enable @next/next/no-img-element */
