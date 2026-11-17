// Confere a limpeza de SVG (src/lib/svg/sanitizar.ts) contra os ataques
// conhecidos. Uso: node scripts/testar-sanitizar-svg.mjs (Node 22.18+ ou 23.6+,
// que importam .ts removendo os tipos). Sai com código 1 se algo falhar.
import { JSDOM } from "jsdom";
import { exit } from "node:process";
import { sanitizarSvg } from "../src/lib/svg/sanitizar.ts";

const SVG = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"';
const DESENHO = '<rect id="base" width="10" height="10"/>';
// Valores inofensivos enquanto ficam entre aspas. Se o texto limpo voltar a
// passar por String.replace, $' (o resto do texto) e $& (a própria abertura)
// copiam esses trechos para dentro de class="...", as aspas fecham antes e
// "onload=alert(1)" vira atributo de verdade.
const ARMADILHA = '<g id="a onload=alert(1) b"><desc>" onload="alert(1)" x="</desc></g>';
const ID_ARMADILHA = 'id="a onload=alert(1) b"';

const ATAQUES = {
  "dólar-apóstrofo": `<svg ${SVG} class="$'">${ARMADILHA}${DESENHO}</svg>`,
  "dólar-e-comercial": `<svg ${SVG} ${ID_ARMADILHA} class="$&">${DESENHO}</svg>`,
  "dólar-crase": `<svg ${SVG} ${ID_ARMADILHA} class="$\`">${ARMADILHA}${DESENHO}</svg>`,
  "dólar-dólar-apóstrofo": `<svg ${SVG} class="$$'">${ARMADILHA}${DESENHO}</svg>`,
  "dólar com xlink": `<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink" class="$'">${ARMADILHA}<linearGradient id="g1"/><linearGradient id="g2" xlink:href="#g1"/>${DESENHO}</svg>`,
  onload: `<svg ${SVG} onload="alert(1)">${DESENHO}</svg>`,
  onclick: `<svg ${SVG}>${DESENHO}<rect id="r" width="1" height="1" onclick="alert(1)" ONMOUSEOVER="alert(2)"/></svg>`,
  script: `<svg ${SVG}>${DESENHO}<script>alert(1)</script></svg>`,
  foreignObject: `<svg ${SVG}>${DESENHO}<foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>`,
  "use externo": `<svg ${SVG}>${DESENHO}<use href="https://evil.example/x.svg#a"/><use xlink:href="https://evil.example/x.svg#b"/></svg>`,
  "href javascript": `<svg ${SVG} xmlns:xlink="http://www.w3.org/1999/xlink">${DESENHO}<a href="javascript:alert(1)"><rect width="1" height="1"/></a><a xlink:href="javascript:alert(2)"><rect width="1" height="1"/></a></svg>`,
  "href externo": `<svg ${SVG}>${DESENHO}<image href="https://evil.example/x.png" width="1" height="1"/></svg>`,
  "atributo style": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" style="fill:url(https://evil.example/x)"/></svg>`,
  "elemento style": `<svg ${SVG}><style>rect{fill:url(https://evil.example/x)}</style>${DESENHO}</svg>`,
  "cursor url": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" cursor="url(https://evil.example/c.cur), auto"/></svg>`,
  "filter url": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" filter="url(https://evil.example/f.svg#f)"/></svg>`,
  "fill url": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" fill="url(https://evil.example/g.svg#g)"/></svg>`,
  "fill URL maiúsculo": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" fill="URL(https://evil.example/g)"/></svg>`,
  "url escapado": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" fill="u\\72l(https://evil.example/g)"/><rect width="1" height="1" stroke="u\\000072 l(https://evil.example/h)"/></svg>`,
  "url local seguido de externo": `<svg ${SVG}>${DESENHO}<rect width="1" height="1" fill="url(#a) url(https://evil.example/x)"/></svg>`,
};

const PROIBIDOS = ["script", "foreignobject", "style", "use", "iframe"];

let falhas = 0;

function falhar(caso, motivo) {
  falhas += 1;
  console.error(`FALHA [${caso}]: ${motivo}`);
}

function soUrlLocal(valor) {
  return !/url\(/i.test(valor) || /^url\(\s*#[\w.:-]+\s*\)$/i.test(valor.trim());
}

// Confere o resultado do jeito que o navegador vai ler: como HTML (injetado num
// <div>) e como arquivo SVG avulso (XML).
function conferirSeguro(caso, saida) {
  const html = new JSDOM(`<div id="alvo">${saida}</div>`).window.document.getElementById("alvo");
  for (const no of html.querySelectorAll("*")) {
    if (PROIBIDOS.includes(no.localName.toLowerCase())) falhar(caso, `elemento <${no.localName}> sobreviveu`);
    for (const { name, value } of Array.from(no.attributes)) {
      const nome = name.toLowerCase();
      if (nome.startsWith("on")) falhar(caso, `atributo ${name} sobreviveu`);
      if (nome === "style") falhar(caso, "atributo style sobreviveu");
      if ((nome === "href" || nome === "xlink:href") && !/^#[\w.:-]+$/.test(value.trim())) {
        falhar(caso, `${name}="${value}" sobreviveu`);
      }
      if (!soUrlLocal(value.replace(/\\/g, ""))) falhar(caso, `${name}="${value}" com url() externa sobreviveu`);
    }
  }
  if (/u\\0*72\s?l\(/i.test(saida)) falhar(caso, "url escapada sobreviveu");

  try {
    new JSDOM(saida, { contentType: "image/svg+xml" });
  } catch {
    falhar(caso, "resultado não é um SVG (XML) válido");
  }
}

for (const [caso, entrada] of Object.entries(ATAQUES)) {
  const saida = sanitizarSvg(entrada);
  if (saida === null) {
    falhar(caso, "o desenho válido foi descartado inteiro");
    continue;
  }
  conferirSeguro(caso, saida);
  if (!saida.includes('id="base"')) falhar(caso, "o desenho válido não sobreviveu");
}

const VALIDO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado pelo Illustrator -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100">
  <defs>
    <linearGradient id="grad"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <linearGradient id="grad2" xlink:href="#grad"/>
  </defs>
  <g id="quadra-a">
    <path id="A-1" d="M0 0 L10 0 L10 10 Z" fill="url(#grad)"/>
    <polygon id="A-2" points="20,0 30,0 30,10" fill="URL( #grad2 )"/>
    <rect id="A-3" x="40" y="0" width="10" height="10" fill="#2f9e63"/>
  </g>
</svg>`;

{
  const saida = sanitizarSvg(VALIDO);
  if (saida === null) {
    falhar("válido", "SVG válido foi recusado");
  } else {
    conferirSeguro("válido", saida);
    for (const trecho of ['id="quadra-a"', 'id="A-1"', 'id="A-2"', 'id="A-3"', "<path", "<polygon", "<rect", 'fill="url(#grad)"', 'xlink:href="#grad"', 'viewBox="0 0 200 100"']) {
      if (!saida.includes(trecho)) falhar("válido", `${trecho} não sobreviveu`);
    }
    if (!saida.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')) falhar("válido", "faltou declarar xmlns:xlink");
  }
}

{
  const saida = sanitizarSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">${DESENHO}</svg>`, { responsivo: true });
  if (!saida?.includes('viewBox="0 0 300 150"') || /\s(?:width|height)="(?:300|150)"/.test(saida)) {
    falhar("responsivo", `viewBox não foi criado a partir de width/height: ${saida}`);
  }
  if (sanitizarSvg(`<svg xmlns="http://www.w3.org/2000/svg">${DESENHO}</svg>`, { responsivo: true }) !== null) {
    falhar("responsivo", "SVG sem viewBox nem medidas deveria ser recusado");
  }
}

for (const [caso, entrada] of Object.entries({
  vazio: "",
  espaços: "   \n ",
  "raiz não svg": `<div>${DESENHO}</div>`,
  "dois svgs": `<svg ${SVG}>${DESENHO}</svg><svg ${SVG}>${DESENHO}</svg>`,
  "svg sem desenho": `<svg ${SVG}></svg>`,
  "só script": `<svg ${SVG}><script>alert(1)</script></svg>`,
  "img com onerror": `<img src=x onerror="alert(1)">`,
})) {
  if (sanitizarSvg(entrada) !== null) falhar(caso, "deveria ser recusado (null)");
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  exit(1);
}
console.log(`OK: ${Object.keys(ATAQUES).length} ataques neutralizados, SVG válido preservado e entradas inválidas recusadas.`);
