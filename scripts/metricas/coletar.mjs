// Coleta as métricas do GitHub do André: repositórios pessoais e de todas as organizações dele (privados incluídos),
// contribuições de todos os anos, commits de autoria dele, deploys e stacks encontradas nos manifestos de cada repo.
// Precisa de um token com acesso de leitura aos repositórios privados e às organizações (PAT clássico com `repo` e
// `read:org`), em METRICAS_TOKEN ou GH_TOKEN. Sem dependências: Node 20+.
// Nada de nome de repositório privado sai daqui: só números e nomes de tecnologia.

const API = 'https://api.github.com';
const TOKEN = process.env.METRICAS_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('falta METRICAS_TOKEN (PAT com repo e read:org)');

const cabecalhos = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'metricas-do-perfil',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function rest(caminho, { tentativas = 3 } = {}) {
  for (let i = 1; ; i++) {
    const r = await fetch(caminho.startsWith('http') ? caminho : API + caminho, { headers: cabecalhos });
    if (r.status === 404 || r.status === 409) return null; // repo vazio ou sem o recurso
    if (r.ok) return { corpo: await r.json(), link: r.headers.get('link') || '' };
    if (i >= tentativas) throw new Error(`${caminho}: HTTP ${r.status}`);
    await new Promise((s) => setTimeout(s, 1500 * i));
  }
}

async function paginas(caminho, chave) {
  const itens = [];
  let url = API + caminho + (caminho.includes('?') ? '&' : '?') + 'per_page=100';
  while (url) {
    const r = await rest(url);
    if (!r) break;
    itens.push(...(chave ? r.corpo[chave] : r.corpo));
    url = /<([^>]+)>;\s*rel="next"/.exec(r.link)?.[1] || null;
  }
  return itens;
}

async function gql(query, variables = {}) {
  const r = await fetch(API + '/graphql', {
    method: 'POST',
    headers: { ...cabecalhos, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

/** total de itens de uma listagem REST, pelo número da última página com per_page=1 */
async function totalPorLink(caminho) {
  const r = await rest(API + caminho + (caminho.includes('?') ? '&' : '?') + 'per_page=1');
  if (!r) return 0;
  const ultima = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(r.link);
  if (ultima) return Number(ultima[1]);
  const corpo = Array.isArray(r.corpo) ? r.corpo : r.corpo.workflow_runs || [];
  return corpo.length;
}

// ── stacks: regras sobre os arquivos do repositório ───────────────────────────────────────────────────────────────
const DEP_JS = [
  ['React', /^react$/], ['Next.js', /^next$/], ['Vite', /^vite$/], ['Tailwind CSS', /^tailwindcss$/],
  ['Three.js', /^three$/], ['React Three Fiber', /^@react-three\/fiber$/], ['Expo', /^expo$/],
  ['React Native', /^react-native$/], ['Electron', /^electron$/], ['Vitest', /^vitest$/],
  ['Playwright', /^@?playwright(\/test)?$/], ['Express', /^express$/], ['NestJS', /^@nestjs\/core$/],
  ['Prisma', /^prisma$|^@prisma\/client$/], ['Motion', /^(framer-motion|motion)$/], ['Sanity', /^sanity$/],
  ['TanStack Query', /^@tanstack\/react-query$/], ['next-intl', /^next-intl$/], ['Zod', /^zod$/],
  ['Socket.IO', /^socket\.io(-client)?$/], ['Hono', /^hono$/], ['Astro', /^astro$/], ['Vue', /^vue$/],
  ['Svelte', /^svelte$/], ['Jest', /^jest$/], ['Storybook', /^storybook$|^@storybook\//], ['TypeScript', /^typescript$/],
];
const ARQUIVOS = [
  ['TypeScript', /(^|\/)tsconfig(\.[\w-]+)?\.json$/],
  ['Docker', /(^|\/)Dockerfile(\.[\w-]+)?$|\.Dockerfile$/],
  ['Docker Compose', /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/],
  ['GitHub Actions', /^\.github\/workflows\/[^/]+\.ya?ml$/],
  ['Python', /(^|\/)(pyproject\.toml|requirements[\w-]*\.txt)$/],
  ['Java', /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/],
  ['PHP', /(^|\/)composer\.json$/],
  ['Go', /(^|\/)go\.mod$/],
  ['Rust', /(^|\/)Cargo\.toml$/],
  ['Cloudflare Workers', /(^|\/)wrangler\.(toml|jsonc?)$/],
  ['Vercel', /(^|\/)vercel\.json$/],
  ['PostgreSQL', /\.sql$/],
];
const IGNORAR = /(^|\/)(node_modules|vendor|dist|build|\.next|out|coverage)\//;

async function stacksDoRepo(dono, nome, ramo) {
  const arvore = await rest(`/repos/${dono}/${nome}/git/trees/${encodeURIComponent(ramo)}?recursive=1`);
  if (!arvore) return new Set();
  const caminhos = arvore.corpo.tree.filter((t) => t.type === 'blob' && !IGNORAR.test(t.path)).map((t) => t.path);
  const achadas = new Set();
  for (const [stack, re] of ARQUIVOS) if (caminhos.some((p) => re.test(p))) achadas.add(stack);

  const ler = async (p) => {
    const r = await rest(`/repos/${dono}/${nome}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ramo)}`);
    return r?.corpo?.content ? Buffer.from(r.corpo.content, 'base64').toString('utf8') : '';
  };

  for (const p of caminhos.filter((c) => /(^|\/)package\.json$/.test(c)).slice(0, 12)) {
    try {
      const pkg = JSON.parse(await ler(p));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
      if (deps.length) achadas.add('Node.js');
      for (const [stack, re] of DEP_JS) if (deps.some((d) => re.test(d))) achadas.add(stack);
    } catch { /* package.json inválido: ignora */ }
  }
  for (const p of caminhos.filter((c) => /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/.test(c)).slice(0, 6)) {
    const t = await ler(p);
    if (/spring-boot/.test(t)) achadas.add('Spring Boot');
    if (/kotlin/.test(t)) achadas.add('Kotlin');
  }
  for (const p of caminhos.filter((c) => /(^|\/)(pyproject\.toml|requirements[\w-]*\.txt)$/.test(c)).slice(0, 6)) {
    const t = (await ler(p)).toLowerCase();
    if (/fastapi/.test(t)) achadas.add('FastAPI');
    if (/django/.test(t)) achadas.add('Django');
    if (/flask/.test(t)) achadas.add('Flask');
  }
  for (const p of caminhos.filter((c) => /(^|\/)composer\.json$/.test(c)).slice(0, 3)) {
    if (/laravel\/framework/.test(await ler(p))) achadas.add('Laravel');
  }
  for (const p of caminhos.filter((c) => /(^|\/)(docker-)?(compose|stack)[\w.-]*\.ya?ml$/.test(c)).slice(0, 6)) {
    const t = await ler(p);
    if (/^\s+deploy:\s*$/m.test(t) && /(replicas|placement|update_config):/.test(t)) achadas.add('Docker Swarm');
    if (/image:\s*\S*postgres/.test(t)) achadas.add('PostgreSQL');
    if (/image:\s*\S*redis/.test(t)) achadas.add('Redis');
    if (/image:\s*\S*rabbitmq/.test(t)) achadas.add('RabbitMQ');
    if (/cloudflared/.test(t)) achadas.add('Cloudflare Tunnel');
    if (/image:\s*\S*nginx/.test(t)) achadas.add('Nginx');
  }
  return achadas;
}

// ── deploys: execuções bem-sucedidas de workflows de deploy + deployments do GitHub (Vercel e afins) ─────────────────
const WORKFLOW_DE_DEPLOY = /deploy|publica|publish|release|produ[cç]/i;

async function deploysDoRepo(dono, nome) {
  let total = 0;
  const wf = await rest(`/repos/${dono}/${nome}/actions/workflows?per_page=100`);
  for (const w of wf?.corpo?.workflows || []) {
    if (!WORKFLOW_DE_DEPLOY.test(w.name) && !WORKFLOW_DE_DEPLOY.test(w.path)) continue;
    total += await totalPorLink(`/repos/${dono}/${nome}/actions/workflows/${w.id}/runs?status=success`);
  }
  // deployments criados por integrações (Vercel, Netlify...); os de environment das Actions já contaram acima
  const deps = await paginas(`/repos/${dono}/${nome}/deployments`);
  total += deps.filter((d) => d.creator?.login && !/github-actions/.test(d.creator.login)).length;
  return total;
}

// ── commits de autoria do André no ramo padrão ────────────────────────────────────────────────────────────────────
async function commitsDoAutor(dono, nome, autorId) {
  const d = await gql(
    `query($o:String!,$n:String!,$a:ID!){ repository(owner:$o,name:$n){ defaultBranchRef{ target{ ... on Commit {
       meus: history(author:{id:$a}){ totalCount } todos: history{ totalCount } } } } } }`,
    { o: dono, n: nome, a: autorId },
  );
  const t = d.repository?.defaultBranchRef?.target;
  return { meus: t?.meus?.totalCount || 0, todos: t?.todos?.totalCount || 0 };
}

// ── contribuições de todos os anos (por organização, quando pedido) ──────────────────────────────────────────────
async function contribuicoes(login, desde, orgId) {
  let total = 0;
  const dias = [];
  const hoje = new Date();
  for (let ano = new Date(desde).getUTCFullYear(); ano <= hoje.getUTCFullYear(); ano++) {
    const de = new Date(Date.UTC(ano, 0, 1)).toISOString();
    const ate = ano === hoje.getUTCFullYear() ? hoje.toISOString() : new Date(Date.UTC(ano, 11, 31, 23, 59, 59)).toISOString();
    const d = await gql(
      `query($l:String!,$de:DateTime!,$ate:DateTime!,$org:ID){ user(login:$l){ contributionsCollection(from:$de,to:$ate,organizationID:$org){
         contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`,
      { l: login, de, ate, org: orgId || null },
    );
    const cal = d.user.contributionsCollection.contributionCalendar;
    total += cal.totalContributions;
    for (const w of cal.weeks) dias.push(...w.contributionDays);
  }
  return { total, dias };
}

function sequencias(dias) {
  const ordenados = [...dias].sort((a, b) => a.date.localeCompare(b.date));
  let maior = 0, corrente = 0;
  for (const d of ordenados) { corrente = d.contributionCount > 0 ? corrente + 1 : 0; maior = Math.max(maior, corrente); }
  // a sequência atual não quebra por hoje ainda estar vazio
  let atual = 0;
  const ate = ordenados.length - (ordenados.at(-1)?.contributionCount ? 0 : 1);
  for (let i = ate - 1; i >= 0 && ordenados[i].contributionCount > 0; i--) atual++;
  const ativos = ordenados.filter((d) => d.contributionCount > 0).length;
  return { atual, maior, ativos };
}

async function emLotes(itens, n, fn) {
  const out = [];
  for (let i = 0; i < itens.length; i += n) out.push(...(await Promise.all(itens.slice(i, i + n).map(fn))));
  return out;
}

export async function coletar({ orgFoco = 'Stream-Builders' } = {}) {
  const eu = (await gql('{ viewer { login id createdAt organizations(first:50){ nodes{ login id } } } }')).viewer;

  // repositórios: os pessoais e os de cada organização, sem repetir e sem forks
  const vistos = new Map();
  const juntar = (lista) => { for (const r of lista) if (!r.fork && !r.archived) vistos.set(r.full_name, r); };
  juntar(await paginas('/user/repos?affiliation=owner,organization_member,collaborator'));
  for (const o of eu.organizations.nodes) juntar(await paginas(`/orgs/${o.login}/repos?type=all`));
  const repos = [...vistos.values()].filter((r) => r.size > 0);

  const detalhes = await emLotes(repos, 6, async (r) => {
    const [dono, nome] = r.full_name.split('/');
    const [stacks, deploys, commits] = await Promise.all([
      stacksDoRepo(dono, nome, r.default_branch),
      deploysDoRepo(dono, nome),
      commitsDoAutor(dono, nome, eu.id),
    ]);
    return { dono, privado: r.private, linguagem: r.language, stacks, deploys, commits };
  });

  const linguagensPorBytes = async (lista) => {
    const soma = new Map();
    await emLotes(lista, 8, async (r) => {
      const l = await rest(`/repos/${r.full_name}/languages`);
      for (const [k, v] of Object.entries(l?.corpo || {})) soma.set(k, (soma.get(k) || 0) + v);
    });
    const total = [...soma.values()].reduce((a, b) => a + b, 0) || 1;
    return [...soma].sort((a, b) => b[1] - a[1]).map(([nome, bytes]) => ({ nome, fatia: bytes / total }));
  };

  const resumo = (lista, reposDaLista) => {
    const ranking = new Map();
    for (const d of lista) for (const s of d.stacks) ranking.set(s, (ranking.get(s) || 0) + 1);
    return {
      repos: lista.length,
      privados: lista.filter((d) => d.privado).length,
      publicos: lista.filter((d) => !d.privado).length,
      commits: lista.reduce((a, d) => a + d.commits.meus, 0),
      commitsTodos: lista.reduce((a, d) => a + d.commits.todos, 0),
      deploys: lista.reduce((a, d) => a + d.deploys, 0),
      stacks: [...ranking].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([nome, n]) => ({ nome, repos: n })),
      _repos: reposDaLista,
    };
  };

  const org = eu.organizations.nodes.find((o) => o.login.toLowerCase() === orgFoco.toLowerCase());
  const daOrg = detalhes.filter((d) => d.dono.toLowerCase() === orgFoco.toLowerCase());
  const reposOrg = repos.filter((r) => r.owner.login.toLowerCase() === orgFoco.toLowerCase());

  const [contribTudo, contribOrg] = await Promise.all([
    contribuicoes(eu.login, eu.createdAt),
    org ? contribuicoes(eu.login, eu.createdAt, org.id) : Promise.resolve({ total: 0, dias: [] }),
  ]);

  // na org, a API não atribui as contribuições privadas à organização: soma commits (todos os autores), PRs e issues
  const buscaTotal = async (q) => (await rest(`/search/issues?per_page=1&q=${encodeURIComponent(q)}`))?.corpo?.total_count || 0;
  const pessoal = { ...resumo(detalhes, repos), organizacoes: eu.organizations.nodes.length, contribuicoes: contribTudo.total, ...sequencias(contribTudo.dias), dias: contribTudo.dias };
  const daOrganizacao = { ...resumo(daOrg, reposOrg), dias: contribOrg.dias };
  daOrganizacao.prs = await buscaTotal(`org:${orgFoco} is:pr`);
  daOrganizacao.issues = await buscaTotal(`org:${orgFoco} is:issue`);
  daOrganizacao.contribuicoes = daOrganizacao.commitsTodos + daOrganizacao.prs + daOrganizacao.issues;
  pessoal.linguagens = await linguagensPorBytes(repos);
  daOrganizacao.linguagens = await linguagensPorBytes(reposOrg);
  delete pessoal._repos; delete daOrganizacao._repos;
  return { login: eu.login, desde: eu.createdAt, geradoEm: new Date().toISOString(), pessoal, org: { login: org?.login || orgFoco, ...daOrganizacao } };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('coletar.mjs')) {
  const dados = await coletar();
  const sem = (o) => ({ ...o, dias: `${o.dias.length} dias` });
  console.log(JSON.stringify({ ...dados, pessoal: sem(dados.pessoal), org: sem(dados.org) }, null, 1));
}
