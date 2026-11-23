// Desenha os SVGs de métricas do perfil pessoal e do README da organização a partir do que o coletar.mjs mediu.
// Uso: node scripts/metricas/desenhar.mjs --pessoal <pasta> --org <pasta> [--dados cache.json] [--salvar cache.json]
// O SVG é mostrado pelo GitHub como <img>: sem fonte externa, sem script, e todo texto cabe no espaço medido para ele.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { coletar } from './coletar.mjs';

const require = createRequire(import.meta.url);
const { generateActivitySvg } = require('../generate-activity.js');

const VERMELHO = '#FF3333';
const CREME = '#EFE6D0';
const APAGADO = '#8A8378';
const FUNDO = '#050505';
const FONTE = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";

const arg = (nome) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : undefined; };
const num = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const data = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const mesAno = (iso) => { const d = new Date(iso); return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** largura aproximada de um texto (as fontes do sistema variam: a conta é para a mais larga das que listamos) */
const largura = (texto, tam, negrito = false) => [...String(texto)].reduce((a, c) => {
  const f = /[MW@%]/.test(c) ? 0.92 : /[A-Z0-9#&]/.test(c) ? 0.70 : /[il.,:;'|! ]/.test(c) ? 0.32 : 0.58;
  return a + f * tam * (negrito ? 1.06 : 1);
}, 0);

/** encolhe a fonte até o texto caber na largura dada */
const caber = (texto, tam, max, negrito) => { let t = tam; while (t > 8 && largura(texto, t, negrito) > max) t -= 0.5; return t; };

function moldura(w, h, titulo, subtitulo) {
  const cantos = [[1, 15, 1, 1, 15, 1], [w - 1, 15, w - 1, 1, w - 15, 1], [1, h - 15, 1, h - 1, 15, h - 1], [w - 1, h - 15, w - 1, h - 1, w - 15, h - 1]]
    .map(([a, b, c, d, e, f]) => `<path d="M${a} ${b} L${c} ${d} L${e} ${f}" stroke="${VERMELHO}" stroke-width="2.5" fill="none"/>`).join('');
  const tTitulo = caber(titulo, 18, w - 50, true);
  return `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="10" fill="${FUNDO}" stroke="${VERMELHO}" stroke-width="1.5" stroke-opacity="0.6"/>${cantos}
  <text x="25" y="36" font-family="${FONTE}" font-size="${tTitulo}" font-weight="700" letter-spacing="0.5" fill="${VERMELHO}">${esc(titulo)}</text>
  <text x="25" y="56" font-family="${FONTE}" font-size="11" fill="${APAGADO}">${esc(subtitulo)}</text>`;
}

/** cartão de números: 3 colunas, quantas linhas precisar */
function cartaoDeNumeros({ titulo, subtitulo, itens, rotulo }) {
  const w = 900, colunas = 3, gx = 25, gap = 14, topo = 74, alt = 86;
  const lw = (w - 2 * gx - gap * (colunas - 1)) / colunas;
  const linhas = Math.ceil(itens.length / colunas);
  const h = topo + linhas * (alt + gap) + 10;
  const blocos = itens.map((it, i) => {
    const x = gx + (i % colunas) * (lw + gap), y = topo + Math.floor(i / colunas) * (alt + gap);
    const tValor = caber(it.valor, 30, lw - 32, true);
    const tRotulo = caber(it.rotulo, 11.5, lw - 32, true);
    const tNota = caber(it.nota || '', 10.5, lw - 32);
    return `<g transform="translate(${x.toFixed(1)} ${y})">
    <rect width="${lw.toFixed(1)}" height="${alt}" rx="6" fill="#120607" stroke="${VERMELHO}" stroke-opacity="0.35"/>
    <rect width="3" height="${alt}" rx="1.5" fill="${VERMELHO}"/>
    <text x="16" y="38" font-family="${FONTE}" font-size="${tValor}" font-weight="800" fill="${VERMELHO}">${esc(it.valor)}</text>
    <text x="16" y="58" font-family="${FONTE}" font-size="${tRotulo}" font-weight="700" letter-spacing="0.6" fill="${CREME}">${esc(it.rotulo)}</text>
    <text x="16" y="75" font-family="${FONTE}" font-size="${tNota}" fill="${APAGADO}">${esc(it.nota || '')}</text>
  </g>`;
  }).join('\n  ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(rotulo)}">
  <title>${esc(rotulo)}</title>
  ${moldura(w, h, titulo, subtitulo)}
  ${blocos}
</svg>
`;
}

/** ranking de stacks em barras horizontais: quantos repositórios usam cada uma */
function cartaoDeStacks({ titulo, subtitulo, stacks, totalRepos, rotulo, maximo = 14 }) {
  const w = 900, topo = 76, passo = 27, gx = 25;
  const lista = stacks.slice(0, maximo);
  const h = topo + lista.length * passo + 22;
  const colNome = 190, colValor = 130;
  const larguraBarra = w - 2 * gx - colNome - colValor - 30;
  const maior = lista[0]?.repos || 1;
  const linhas = lista.map((s, i) => {
    const y = topo + i * passo;
    const bw = Math.max(4, (s.repos / maior) * larguraBarra);
    const pct = Math.round((s.repos / totalRepos) * 100);
    const tNome = caber(s.nome, 12.5, colNome - 34, true);
    return `<g transform="translate(${gx} ${y})">
    <text x="0" y="13" font-family="${FONTE}" font-size="11" font-weight="700" fill="${APAGADO}">${String(i + 1).padStart(2, '0')}</text>
    <text x="28" y="13" font-family="${FONTE}" font-size="${tNome}" font-weight="700" fill="${CREME}">${esc(s.nome)}</text>
    <rect x="${colNome}" y="2" width="${larguraBarra}" height="14" rx="3" fill="#1A0B0C"/>
    <rect x="${colNome}" y="2" width="${bw.toFixed(1)}" height="14" rx="3" fill="${VERMELHO}" fill-opacity="${(1 - i * 0.045).toFixed(2)}"/>
    <text x="${colNome + larguraBarra + 14}" y="13" font-family="${FONTE}" font-size="11.5" font-weight="700" fill="${VERMELHO}">${s.repos}<tspan fill="${APAGADO}" font-weight="400"> repos · ${pct}%</tspan></text>
  </g>`;
  }).join('\n  ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(rotulo)}">
  <title>${esc(rotulo)}</title>
  ${moldura(w, h, titulo, subtitulo)}
  ${linhas}
</svg>
`;
}

const dadosEm = arg('--dados');
const dados = dadosEm && fs.existsSync(dadosEm) ? JSON.parse(fs.readFileSync(dadosEm, 'utf8')) : await coletar();
if (arg('--salvar')) fs.writeFileSync(arg('--salvar'), JSON.stringify(dados));

const p = dados.pessoal, o = dados.org;
const atualizado = `updated ${data(dados.geradoEm)}`;

const pastaPessoal = arg('--pessoal');
if (pastaPessoal) {
  const escopo = `personal + ${p.organizacoes} organizations · private repos included · since ${mesAno(dados.desde)} · ${atualizado}`;
  fs.writeFileSync(path.join(pastaPessoal, 'metrics.svg'), cartaoDeNumeros({
    titulo: 'GITHUB METRICS · ALL REPOSITORIES',
    subtitulo: escopo,
    rotulo: `GitHub metrics: ${num(p.contribuicoes)} contributions, ${num(p.commits)} commits, ${p.repos} repositories (${p.privados} private), ${num(p.deploys)} deploys`,
    itens: [
      { valor: num(p.contribuicoes), rotulo: 'CONTRIBUTIONS', nota: `since ${mesAno(dados.desde)}, all years` },
      { valor: num(p.commits), rotulo: 'COMMITS AUTHORED', nota: 'default branches of every repo' },
      { valor: num(p.repos), rotulo: 'REPOSITORIES', nota: `${p.privados} private · ${p.publicos} public · no forks` },
      { valor: String(p.organizacoes), rotulo: 'ORGANIZATIONS', nota: 'repositories counted in every metric' },
      { valor: num(p.deploys), rotulo: 'DEPLOYS', nota: 'successful CI/CD runs + platform deploys' },
      { valor: `${p.atual} days`, rotulo: 'CURRENT STREAK', nota: `best ${p.maior} days · ${num(p.ativos)} active days` },
    ],
  }));
  fs.writeFileSync(path.join(pastaPessoal, 'stacks.svg'), cartaoDeStacks({
    titulo: 'MOST USED STACKS',
    subtitulo: `found in the manifests of ${p.repos} repositories (personal + organizations) · ${atualizado}`,
    stacks: p.stacks, totalRepos: p.repos,
    rotulo: `Most used stacks: ${p.stacks.slice(0, 5).map((s) => s.nome).join(', ')}`,
  }));
  fs.writeFileSync(path.join(pastaPessoal, 'activity-graph.svg'), generateActivitySvg(p.dias.slice(-31)));
}

const pastaOrg = arg('--org');
if (pastaOrg) {
  fs.writeFileSync(path.join(pastaOrg, 'metrics.svg'), cartaoDeNumeros({
    titulo: `${o.login.toUpperCase()} · ENGINEERING METRICS`,
    subtitulo: `all ${o.repos} repositories of the organization, private included · ${atualizado}`,
    rotulo: `${o.login} metrics: ${num(o.contribuicoes)} contributions, ${o.privados} private repositories, ${num(o.commitsTodos)} commits, ${num(o.deploys)} deploys`,
    itens: [
      { valor: num(o.contribuicoes), rotulo: 'CONTRIBUTIONS', nota: `commits + ${num(o.prs)} pull requests + ${num(o.issues)} issues` },
      { valor: String(o.privados), rotulo: 'PRIVATE REPOSITORIES', nota: `of ${o.repos} in total · ${o.publicos} public` },
      { valor: num(o.commitsTodos), rotulo: 'COMMITS', nota: 'default branches, every author' },
      { valor: num(o.deploys), rotulo: 'DEPLOYS', nota: 'successful CI/CD runs + platform deploys' },
      { valor: String(o.stacks.length), rotulo: 'STACKS FOUND', nota: 'frameworks, runtimes and infra' },
      { valor: o.stacks[0]?.nome || '-', rotulo: 'MOST COMMON STACK', nota: o.stacks[0] ? `in ${o.stacks[0].repos} of ${o.repos} repositories` : '' },
    ],
  }));
  fs.writeFileSync(path.join(pastaOrg, 'stacks.svg'), cartaoDeStacks({
    titulo: 'STACK RANKING',
    subtitulo: `most common stacks across the ${o.repos} repositories · ${atualizado}`,
    stacks: o.stacks, totalRepos: o.repos,
    rotulo: `Stack ranking: ${o.stacks.slice(0, 5).map((s) => s.nome).join(', ')}`,
  }));
}
console.log(`pessoal: ${p.repos} repos, ${p.commits} commits, ${p.deploys} deploys · org: ${o.repos} repos, ${o.commitsTodos} commits, ${o.deploys} deploys`);
