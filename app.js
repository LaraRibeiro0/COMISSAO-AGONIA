import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_COMISSAO } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* =========================================================
   Utilitários
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtEur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const eur = v => fmtEur.format(Number(v) || 0);
const soma = (lista, campo) => lista.reduce((t, x) => t + (Number(x[campo]) || 0), 0);
const num = v => (v === '' || v == null) ? null : Number(String(v).replace(',', '.'));
const idOuNull = v => (v === '' || v == null) ? null : Number(v);

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hojeIso = () => iso(new Date());
const fmtCurta = s => parse(s).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
const fmtLonga = s => parse(s).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
// sábado do fim de semana a que um dia pertence (dias úteis → próximo sábado)
function sabadoDe(d) {
  const dow = d.getDay();
  if (dow === 6) return d;
  if (dow === 0) return addDias(d, -1);
  return addDias(d, 6 - dow);
}
const fmtFds = sab => {
  const s = parse(sab), d = addDias(s, 1);
  const mes = d.toLocaleDateString('pt-PT', { month: 'short' });
  return s.getMonth() === d.getMonth()
    ? `${s.getDate()}–${d.getDate()} ${mes} ${d.getFullYear()}`
    : `${fmtCurta(sab)} – ${fmtCurta(iso(d))} ${d.getFullYear()}`;
};

/* =========================================================
   Estado e dados
   ========================================================= */
const TABELAS = ['equipas', 'funcoes', 'responsabilidades', 'categorias_despesa',
  'pessoas', 'fins_de_semana', 'eventos', 'despesas', 'festa_atuacoes', 'utilizadores',
  'produtos', 'encomendas_fixas', 'encomendas', 'festa_categorias', 'festa_responsaveis',
  'patrocinios', 'tarefas'];
const D = Object.fromEntries(TABELAS.map(t => [t, []]));
D.atividade = [];
const S = {
  vista: 'inicio',
  mes: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  filtroEquipa: '',     // calendário
  despFds: '', despCat: '', // aba Despesas
  dashCat: '',          // dashboard
  listaSec: 'despesas', // Listas: despesas | encomendas | config
  encProd: '', encCat: '', encFds: '', // filtros das encomendas
  festaCat: '',         // filtro da festa
  tarefasVer: 'abertas', // abertas | minhas | feitas
  patTipo: '', patProd: '', // filtros dos patrocínios
};
const porId = (t, id) => D[t].find(x => x.id === Number(id));
const equipa = id => porId('equipas', id);
const fdsPorSabado = sab => D.fins_de_semana.find(f => f.data_sabado === sab);

/* ---------- Encomendas: ocorrências semanais ---------- */
const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const diaSemanaDe = s => ((parse(s).getDay() + 6) % 7) + 1; // 1 = segunda
const fmtNum = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 });
const nomeProduto = id => porId('produtos', id)?.nome || 'Produto';
const textoItens = itens => (itens || []).filter(i => i.produto_id)
  .map(i => (i.quantidade != null && i.quantidade !== '' ? fmtNum.format(i.quantidade) + ' × ' : '') + nomeProduto(i.produto_id)).join(', ');

// Uma encomenda por (encomenda fixa × fim de semana registado). Só é gravada na
// base de dados quando alguém a altera, marca como encomendada ou remove.
function ocorrencias() {
  const lista = [], gravadas = new Set();
  for (const r of D.encomendas) {
    const fds = porId('fins_de_semana', r.fim_de_semana_id);
    if (!fds) continue;
    if (r.fixa_id) gravadas.add(r.fixa_id + '-' + r.fim_de_semana_id);
    lista.push({
      key: 'r' + r.id, registo: r, fixa: r.fixa_id ? porId('encomendas_fixas', r.fixa_id) : null, fds,
      categoria_id: r.categoria_id, pessoa_id: r.pessoa_id, data: r.data, itens: r.itens || [], notas: r.notas,
      removida: r.removida, encomendada_em: r.encomendada_em, encomendada_por: r.encomendada_por, despesa_id: r.despesa_id,
    });
  }
  for (const fds of D.fins_de_semana) {
    const domingo = iso(addDias(parse(fds.data_sabado), 1));
    const segunda = addDias(parse(fds.data_sabado), -5);
    for (const f of D.encomendas_fixas) {
      if (!f.ativa || domingo < f.desde || gravadas.has(f.id + '-' + fds.id)) continue;
      lista.push({
        key: `v${f.id}-${fds.id}`, registo: null, fixa: f, fds,
        categoria_id: f.categoria_id, pessoa_id: f.pessoa_id, data: iso(addDias(segunda, f.dia_semana - 1)),
        itens: f.itens || [], notas: f.notas, removida: false, encomendada_em: null, encomendada_por: null, despesa_id: null,
      });
    }
  }
  return lista;
}

async function carregar() {
  const res = await Promise.all(TABELAS.map(t => sb.from(t).select('*').order('id')));
  res.forEach((r, i) => { if (r.error) throw r.error; D[TABELAS[i]] = r.data; });
  const at = await sb.from('atividade').select('*').order('id', { ascending: false }).limit(40);
  if (!at.error) D.atividade = at.data;
}

/* =========================================================
   Utilizadores: quem está a usar este dispositivo
   ========================================================= */
const CHAVE_DISP = 'comissao_dispositivo';
function dispositivoId() {
  let id = null;
  try { id = localStorage.getItem(CHAVE_DISP); } catch {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      }));
    try { localStorage.setItem(CHAVE_DISP, id); } catch {}
  }
  return id;
}
const utilizadorAtual = () => D.utilizadores.find(u => u.dispositivo === dispositivoId());
function tipoAparelho() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Tablet Android';
  return 'Computador';
}

// descrição curta de um registo, para o registo de atividade
const NOMES_TABELA = {
  equipas: 'a equipa', funcoes: 'a função', responsabilidades: 'a responsabilidade',
  categorias_despesa: 'a categoria', pessoas: 'a pessoa', fins_de_semana: 'o fim de semana',
  eventos: 'o evento', despesas: 'a despesa', festa_atuacoes: 'na festa',
  produtos: 'o produto', encomendas_fixas: 'a encomenda fixa', encomendas: 'a encomenda',
  festa_categorias: 'a categoria da festa', festa_responsaveis: 'o responsável da festa',
  patrocinios: 'o patrocínio', tarefas: 'a tarefa',
};
function descrever(tabela, v) {
  if (!v) return '';
  if (tabela === 'despesas') return `${porId('categorias_despesa', v.categoria_id)?.nome || ''} ${eur(v.preco)}`.trim();
  if (tabela === 'fins_de_semana') return fmtFds(v.data_sabado);
  if (tabela === 'festa_atuacoes') return v.artista;
  if (tabela === 'encomendas') return `${porId('categorias_despesa', v.categoria_id)?.nome || ''} (${v.data ? fmtCurta(v.data) : ''})`;
  if (tabela === 'encomendas_fixas') return `${porId('categorias_despesa', v.categoria_id)?.nome || ''}, às ${(DIAS_SEMANA[v.dia_semana - 1] || '').toLowerCase()}s`;
  return v.nome || '';
}
async function registarAtividade(acao, tabela, registoId, obj) {
  const u = utilizadorAtual();
  try {
    await sb.from('atividade').insert({
      utilizador_id: u?.id ?? null, nome: u?.nome ?? 'Desconhecido',
      acao, tabela, registo_id: registoId ?? null,
      descricao: NOMES_TABELA[tabela]
        ? `${acao} ${NOMES_TABELA[tabela]}${descrever(tabela, obj) ? ': ' + descrever(tabela, obj) : ''}`
        : acao,
    });
  } catch (e) { console.warn('atividade', e); }
}

// tabelas que guardam o nome de quem criou o registo
const COM_AUTOR = new Set(['equipas', 'pessoas', 'fins_de_semana', 'eventos', 'despesas', 'festa_atuacoes',
  'encomendas_fixas', 'patrocinios', 'tarefas', 'produtos', 'categorias_despesa', 'funcoes',
  'responsabilidades', 'festa_categorias', 'festa_responsaveis']);
const autor = x => x?.criado_por ? `<div class="autor">Criado por ${esc(x.criado_por)}</div>` : '';

async function guardar(tabela, valores, id, acaoTexto) {
  if (id) {
    const { error } = await sb.from(tabela).update(valores).eq('id', id);
    if (error) throw error;
    await registarAtividade(acaoTexto || 'alterou', tabela, id, { ...porId(tabela, id), ...valores });
    return id;
  }
  if (COM_AUTOR.has(tabela)) valores = { ...valores, criado_por: utilizadorAtual()?.nome ?? null };
  const { data, error } = await sb.from(tabela).insert(valores).select('id').single();
  if (error) throw error;
  await registarAtividade(acaoTexto || (tabela === 'festa_atuacoes' ? 'adicionou' : 'criou'), tabela, data?.id, valores);
  return data?.id;
}
async function apagar(tabela, id) {
  const antes = porId(tabela, id);
  const { error } = await sb.from(tabela).delete().eq('id', id);
  if (error) throw error;
  await registarAtividade('apagou', tabela, id, antes);
}

function erroLegivel(e) {
  if (e?.code === '23503') return 'Não é possível apagar: há registos que usam este item.';
  if (e?.code === '23505') return 'Já existe um registo igual (nome ou data repetidos).';
  if (e?.code === '23514') return 'Valor inválido. Confirma os campos.';
  if (/JWT|session|auth/i.test(e?.message || '')) return 'A sessão expirou. Volta a entrar.';
  return 'Erro: ' + (e?.message || 'não foi possível guardar.');
}

// corre uma alteração, recarrega os dados e atualiza o ecrã
async function acao(fn, msg, depois) {
  try {
    await fn();
    await carregar();
    if (depois) depois(); else fecharSheet();
    render();
    if (msg) toast(msg);
  } catch (e) {
    console.error(e);
    toast(erroLegivel(e), true);
  }
}

/* =========================================================
   UI base: toast, sheet, navegação
   ========================================================= */
let toastT;
function toast(msg, mau = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = mau ? 'mau' : ''; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), mau ? 4500 : 2200);
}

function abrirSheet(titulo, html, montar) {
  $('#sheet-titulo').textContent = titulo;
  $('#sheet-corpo').innerHTML = html;
  $('#sheet-wrap').hidden = false;
  $('.sheet').scrollTop = 0;
  if (montar) montar($('#sheet-corpo'));
}
function fecharSheet() { $('#sheet-wrap').hidden = true; $('#sheet-corpo').innerHTML = ''; }

const TITULOS = { inicio: 'Início', calendario: 'Calendário', festa: 'Festa', equipas: 'Equipas', listas: 'Listas' };

function render() {
  $('#titulo').textContent = TITULOS[S.vista];
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('ativo', b.dataset.vista === S.vista));
  const v = { inicio: vInicio, calendario: vCalendario, festa: vFesta, equipas: vEquipas, listas: vListas }[S.vista];
  $('#conteudo').innerHTML = v();
}

/* ---------- opções de <select> ---------- */
const opt = (v, txt, sel) => `<option value="${esc(v)}"${String(sel ?? '') === String(v) ? ' selected' : ''}>${esc(txt)}</option>`;
const optsLista = (t, sel, vazio) =>
  (vazio ? opt('', vazio, sel) : '') + D[t].map(x => opt(x.id, x.nome, sel)).join('');
const fdsOrdenados = () => [...D.fins_de_semana].sort((a, b) => b.data_sabado.localeCompare(a.data_sabado));
const optsFds = (sel, vazio) => (vazio ? opt('', vazio, sel) : '') + fdsOrdenados()
  .map(f => opt(f.id, `${fmtFds(f.data_sabado)}${equipa(f.equipa_id) ? ' · ' + equipa(f.equipa_id).nome : ''}`, sel)).join('');

function chipEquipa(eqId, todas = false) {
  const e = equipa(eqId);
  if (!e && !todas) return '<span class="chip" style="color:var(--suave)">Sem equipa</span>';
  return `<span class="chip"><span class="ponto" style="--c:${esc(e?.cor)}"></span>${esc(e?.nome || '')}${todas ? (e ? ' + todas' : 'Todas as equipas') : ''}</span>`;
}

/* =========================================================
   Vista: Início (dashboard)
   ========================================================= */
function vInicio() {
  const hoje = hojeIso();
  const realizados = D.fins_de_semana.filter(f => iso(addDias(parse(f.data_sabado), 1)) <= hoje).length;
  const totalDesp = soma(D.despesas, 'preco');
  const lucro = soma(D.fins_de_semana, 'lucro_final');
  const sab = iso(sabadoDe(new Date()));
  const fds = fdsPorSabado(sab);

  const totalPatroc = soma(D.patrocinios.filter(p => p.tipo === 'dinheiro'), 'valor');

  const eventos = [...D.eventos].sort((a, b) => b.data.localeCompare(a.data));
  const encSemana = fds ? ocorrencias().filter(o => o.fds.id === fds.id && !o.removida).sort((a, b) => a.data.localeCompare(b.data)) : [];
  const porEncomendar = encSemana.filter(o => !o.encomendada_em).length;

  // contas a pagar (categorias com valor total definido, ex.: renda)
  const contas = D.categorias_despesa.filter(c => c.total_a_pagar != null && Number(c.total_a_pagar) > 0)
    .map(c => {
      const total = Number(c.total_a_pagar);
      const pago = soma(D.despesas.filter(d => d.categoria_id === c.id), 'preco');
      return { c, total, pago, falta: Math.max(0, total - pago) };
    });

  return `
  <div class="cartao toque" data-acao="abrirFds" data-sab="${sab}">
    <div class="kpi-rotulo">${sab <= hoje || iso(addDias(parse(sab), 1)) === hoje ? 'Este fim de semana' : 'Próximo fim de semana'} · ${fmtFds(sab)}</div>
    <div style="margin-top:8px;font-size:18px">${fds ? chipEquipa(fds.equipa_id) : '<span class="kpi-rotulo">Ainda não definido. Toca para escolher a equipa.</span>'}</div>
  </div>
  <div class="grelha">
    <div class="cartao largo"><div class="kpi-rotulo">Lucro total (soma dos lucros finais de domingo)</div><div class="kpi-valor pos">${eur(lucro)}</div></div>
    <div class="cartao"><div class="kpi-rotulo">Total de despesas</div><div class="kpi-valor">${eur(totalDesp)}</div></div>
    <div class="cartao"><div class="kpi-rotulo">Total de patrocínios</div><div class="kpi-valor">${eur(totalPatroc)}</div></div>
    <div class="cartao largo kpi-linha"><span class="kpi-rotulo">Fins de semana realizados</span><b>${realizados}</b></div>
  </div>

  ${encSemana.length ? `<div class="cartao">
    <h3>Encomendas desta semana ${porEncomendar ? `<span class="etiqueta pendente">${porEncomendar} por fazer</span>` : '<span class="etiqueta feito">Tudo encomendado</span>'}</h3>
    <ul class="lista">${encSemana.map(linhaEncomenda).join('')}</ul>
  </div>` : ''}

  ${contas.length ? `<div class="cartao">
    <h3>Contas a pagar</h3>
    ${contas.map(x => `
      <div class="conta">
        <div class="conta-topo"><b>${esc(x.c.nome)}</b>
          ${x.falta > 0 ? `<span class="falta">Falta pagar ${eur(x.falta)}</span>` : '<span class="pago">Pago ✓</span>'}</div>
        <div class="barra"><i style="width:${Math.min(100, x.pago / x.total * 100).toFixed(1)}%;background:#15803d"></i></div>
        <div class="sub">Pago ${eur(x.pago)} de ${eur(x.total)}</div>
      </div>`).join('')}
  </div>` : ''}

  ${cartaoTarefas()}

  <div class="cartao">
    <h3>Eventos</h3>
    <p class="dica">O lucro dos eventos é só uma nota; já está incluído no lucro final de domingo.</p>
    ${eventos.length ? `<ul class="lista">${eventos.map(e => `
      <li class="toque" data-acao="editarEvento" data-id="${e.id}">
        <div class="princ"><b>${esc(e.nome)}</b><div class="sub">${fmtCurta(e.data)} · ${e.num_pessoas ?? '—'} pessoas</div><div class="sub">${chipEquipa(e.equipa_id, e.todas_equipas)}</div>${autor(e)}</div>
        <span class="valor">${e.nota_lucro != null ? eur(e.nota_lucro) : ''}</span>
      </li>`).join('')}</ul>` : '<div class="vazio">Ainda não há eventos.</div>'}
  </div>`;
}

/* =========================================================
   Vista: Calendário
   ========================================================= */
function visivelEquipa(eqId, todas = false) {
  return !S.filtroEquipa || Number(S.filtroEquipa) === eqId || todas;
}

// "Equipa 1" → "Eq. 1" para caber no quadrado do dia
const nomeCurto = n => { const m = n.match(/^\s*equipa\s+(.+)$/i); return m ? 'Eq. ' + m[1] : n; };

function vCalendario() {
  const m = S.mes, ano = m.getFullYear(), mes = m.getMonth();
  const desloc = (new Date(ano, mes, 1).getDay() + 6) % 7; // segunda = 0
  const diasMes = new Date(ano, mes + 1, 0).getDate();
  const semanas = Math.ceil((desloc + diasMes) / 7);
  const inicio = addDias(new Date(ano, mes, 1), -desloc);
  const hoje = hojeIso();

  const encs = ocorrencias().filter(o => !o.removida);
  let celulas = '';
  for (let i = 0; i < semanas * 7; i++) {
    const dia = addDias(inicio, i), d = iso(dia), dow = dia.getDay();
    const fimSemana = dow === 6 || dow === 0;
    const fds = fimSemana ? fdsPorSabado(iso(sabadoDe(dia))) : null;
    const eq = fds && equipa(fds.equipa_id);
    const pintar = eq && visivelEquipa(eq.id);
    const evs = D.eventos.filter(e => e.data === d && visivelEquipa(e.equipa_id, e.todas_equipas));
    celulas += `
      <div class="dia${dia.getMonth() !== mes ? ' fora' : ''}${d === hoje ? ' hoje' : ''}${pintar ? ' fds' : ''}"
           ${pintar ? `style="--c:${esc(eq.cor)}"` : ''} data-acao="abrirDia" data-data="${d}">
        <span class="num">${dia.getDate()}</span>
        ${pintar ? `<span class="eq">${esc(nomeCurto(eq.nome))}</span>` : ''}
        ${evs.map(e => `<span class="ev${e.todas_equipas ? ' todas' : ''}" style="--c:${esc(equipa(e.equipa_id)?.cor || '#8b5a2b')}">${esc(e.nome)}</span>`).join('')}
        ${encs.filter(o => o.data === d && visivelEquipa(o.fds.equipa_id)).map(o =>
          `<span class="ev enc${o.encomendada_em ? ' ok' : ''}">${o.encomendada_em ? '✓' : '🛒'} ${esc(porId('categorias_despesa', o.categoria_id)?.nome || 'Encomenda')}</span>`).join('')}
      </div>`;
  }

  const t = m.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const titulo = t.charAt(0).toUpperCase() + t.slice(1);
  return `
  <div class="pilulas">
    <button class="pilula${!S.filtroEquipa ? ' ativo' : ''}" data-acao="filtroEquipa" data-id="">Todas</button>
    ${D.equipas.map(e => `<button class="pilula${String(e.id) === String(S.filtroEquipa) ? ' ativo' : ''}" data-acao="filtroEquipa" data-id="${e.id}">
      <span class="ponto" style="--c:${esc(e.cor)}"></span>${esc(e.nome)}</button>`).join('')}
  </div>
  <div class="cal-topo">
    <button class="btn peq" data-acao="mes" data-d="-1" aria-label="Mês anterior">‹</button>
    <h2>${esc(titulo)}</h2>
    <button class="btn peq" data-acao="mes" data-d="1" aria-label="Mês seguinte">›</button>
  </div>
  <div class="cal">
    ${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(x => `<div class="cab">${x}</div>`).join('')}
    ${celulas}
  </div>
  <p class="dica" style="margin-top:12px">Toca num sábado ou domingo para definir a equipa, a ementa, as despesas e o lucro. Toca noutro dia para criar um evento ou ver as encomendas. 🛒 = por encomendar · ✓ = encomendado.</p>
  <button class="fab" data-acao="novoEvento" data-data="${hoje}">+ Evento</button>`;
}

function abrirDia(d) {
  const dia = parse(d), dow = dia.getDay();
  const evs = D.eventos.filter(e => e.data === d);
  let html = '';
  if (dow === 6 || dow === 0) {
    const sab = iso(sabadoDe(dia)), fds = fdsPorSabado(sab);
    const desp = fds ? soma(D.despesas.filter(x => x.fim_de_semana_id === fds.id), 'preco') : 0;
    html += `<div class="cartao toque" data-acao="abrirFds" data-sab="${sab}">
      <h3>Fim de semana ${fmtFds(sab)}</h3>
      ${fds ? `${chipEquipa(fds.equipa_id)}
        <div class="sub" style="margin-top:8px">Despesas: <b>${eur(desp)}</b> · Lucro final: <b>${fds.lucro_final != null ? eur(fds.lucro_final) : '—'}</b></div>
        <div class="acoes"><span class="btn bloco">Abrir fim de semana</span></div>`
      : `<p class="dica" style="margin:0 0 4px">Ainda não foi definido.</p><div class="acoes"><span class="btn primario bloco">Definir fim de semana</span></div>`}
    </div>`;
  }
  const encDia = ocorrencias().filter(o => o.data === d && !o.removida);
  if (encDia.length) html += `<div class="grupo-titulo">Encomendas</div><ul class="lista">${encDia.map(linhaEncomenda).join('')}</ul>`;
  html += `<div class="grupo-titulo">Eventos</div>`;
  html += evs.length ? `<ul class="lista">${evs.map(e => `
    <li class="toque" data-acao="editarEvento" data-id="${e.id}">
      <div class="princ"><b>${esc(e.nome)}</b><div class="sub">${chipEquipa(e.equipa_id, e.todas_equipas)}</div></div>
      <span class="valor">${e.num_pessoas != null ? e.num_pessoas + ' pess.' : ''}</span></li>`).join('')}</ul>`
    : '<div class="vazio">Sem eventos neste dia.</div>';
  html += `<div class="acoes"><button class="btn bloco" data-acao="novoEvento" data-data="${d}">+ Novo evento</button></div>`;
  abrirSheet(fmtLonga(d), html);
}

/* =========================================================
   Fim de semana (equipa, ementas, lucro, despesas)
   ========================================================= */
function abrirFds(sab) {
  const fds = fdsPorSabado(sab);
  const desp = fds ? D.despesas.filter(x => x.fim_de_semana_id === fds.id)
    .sort((a, b) => (b.data_encomenda || '').localeCompare(a.data_encomenda || '')) : [];
  const html = `
  <form id="f-fds">
    <div class="campo"><label>Equipa</label><select name="equipa_id">${optsLista('equipas', fds?.equipa_id, '— Escolher equipa —')}</select></div>
    <div class="campo"><label>Ementa de sábado</label><textarea name="ementa_sabado" placeholder="Ex.: frango, criolo, espetadas…">${esc(fds?.ementa_sabado)}</textarea></div>
    <div class="campo"><label>Ementa de domingo</label><textarea name="ementa_domingo" placeholder="Ex.: take-away de…">${esc(fds?.ementa_domingo)}</textarea></div>
    <div class="campo"><label>Lucro final (€)</label><input name="lucro_final" type="text" inputmode="decimal" placeholder="Preenche no domingo" value="${fds?.lucro_final ?? ''}"></div>
    <p class="dica">Dinheiro líquido do fim de semana, já com o dinheiro dos eventos incluído.</p>
    ${autor(fds)}
    <div class="acoes"><button class="btn primario" type="submit">${fds ? 'Guardar' : 'Criar fim de semana'}</button></div>
  </form>
  ${fds ? `
    <div class="grupo-titulo">Despesas deste fim de semana</div>
    <div class="total-linha"><span>Total</span><b>${eur(soma(desp, 'preco'))}</b></div>
    ${desp.length ? `<ul class="lista">${desp.map(linhaDespesa).join('')}</ul>` : '<div class="vazio">Sem despesas.</div>'}
    <div class="acoes"><button class="btn" data-acao="novaDespesa" data-fds="${fds.id}" data-volta="${sab}">+ Despesa</button></div>
    ${(() => {
      const encs = ocorrencias().filter(o => o.fds.id === fds.id).sort((a, b) => a.data.localeCompare(b.data));
      if (!encs.length) return '';
      const pendentes = encs.filter(o => !o.removida && !o.encomendada_em).length;
      return `<div class="grupo-titulo">Encomendas desta semana</div>
        <ul class="lista">${encs.map(linhaEncomenda).join('')}</ul>
        ${pendentes ? `<div class="acoes"><button class="btn perigo" data-acao="removerSemana" data-fds="${fds.id}">Esta semana não se encomenda nada</button></div>` : ''}`;
    })()}
    <div class="acoes"><button class="btn perigo" data-acao="apagarFds" data-id="${fds.id}">Apagar fim de semana</button></div>` : ''}`;

  abrirSheet(`Fim de semana ${fmtFds(sab)}`, html, el => {
    $('#f-fds', el).onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const lucro = num(f.get('lucro_final'));
      if (lucro != null && Number.isNaN(lucro)) return toast('Lucro inválido.', true);
      const valores = {
        data_sabado: sab,
        equipa_id: idOuNull(f.get('equipa_id')),
        ementa_sabado: f.get('ementa_sabado').trim() || null,
        ementa_domingo: f.get('ementa_domingo').trim() || null,
        lucro_final: lucro,
      };
      acao(() => guardar('fins_de_semana', valores, fds?.id), 'Fim de semana guardado', fds ? null : () => abrirFds(sab));
    };
  });
}

function linhaDespesa(d) {
  const c = porId('categorias_despesa', d.categoria_id), p = porId('pessoas', d.pessoa_id);
  return `<li class="toque" data-acao="editarDespesa" data-id="${d.id}">
    <div class="princ"><b>${esc(c?.nome)}</b>${d.descricao ? ` <span class="sub">· ${esc(d.descricao)}</span>` : ''}
      <div class="sub">${d.data_encomenda ? fmtCurta(d.data_encomenda) : 'Sem data'} · ${esc(p?.nome || 'Sem responsável')}</div>${autor(d)}</div>
    <span class="valor">${eur(d.preco)}</span></li>`;
}

/* =========================================================
   Despesa (formulário)
   ========================================================= */
// Pessoas com a responsabilidade ligada à categoria aparecem primeiro
function optsResponsavel(catId, sel) {
  const cat = porId('categorias_despesa', catId);
  const respId = cat?.responsabilidade_id;
  const rotulo = p => {
    const r = porId('responsabilidades', p.responsabilidade_id), e = equipa(p.equipa_id);
    return [p.nome, r?.nome, e?.nome].filter(Boolean).join(' – ');
  };
  const pessoas = [...D.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const primeiro = respId ? pessoas.filter(p => p.responsabilidade_id === respId) : [];
  const resto = pessoas.filter(p => !primeiro.includes(p));
  let h = opt('', '— Sem responsável —', sel);
  if (primeiro.length) {
    h += `<optgroup label="Responsáveis por ${esc(porId('responsabilidades', respId)?.nome)}">${primeiro.map(p => opt(p.id, rotulo(p), sel)).join('')}</optgroup>`;
    h += `<optgroup label="Outras pessoas">${resto.map(p => opt(p.id, rotulo(p), sel)).join('')}</optgroup>`;
  } else h += resto.map(p => opt(p.id, rotulo(p), sel)).join('');
  return h;
}

// sugere a primeira pessoa responsável pela categoria
const sugerido = cat => {
  const r = porId('categorias_despesa', cat)?.responsabilidade_id;
  return r ? [...D.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).find(p => p.responsabilidade_id === r)?.id ?? '' : '';
};

function abrirDespesa(id, fdsId, voltaSab, pre = {}) {
  const d = id ? porId('despesas', id) : null;
  if (!D.categorias_despesa.length) return toast('Primeiro cria categorias de despesa em Listas.', true);
  const catInicial = d?.categoria_id ?? pre.categoria_id ?? D.categorias_despesa[0].id;
  const fdsInicial = d ? (d.fim_de_semana_id ?? '') : (fdsId ?? fdsOrdenados()[0]?.id ?? '');
  const voltar = pre.voltar ?? (voltaSab ? () => abrirFds(voltaSab) : null);
  const pessoaInicial = d ? d.pessoa_id : (pre.pessoa_id ?? sugerido(catInicial));

  const html = `
  <form id="f-desp">
    <div class="campo"><label>Categoria</label><select name="categoria_id" required>${optsLista('categorias_despesa', catInicial)}</select></div>
    <div class="campo"><label>Responsável</label><select name="pessoa_id">${optsResponsavel(catInicial, pessoaInicial)}</select></div>
    <div class="campo"><label>Dia da encomenda</label><input name="data_encomenda" type="date" value="${d?.data_encomenda ?? pre.data_encomenda ?? hojeIso()}"></div>
    <div class="campo"><label>Preço (€)</label><input name="preco" type="text" inputmode="decimal" required placeholder="0,00" value="${d?.preco ?? ''}"></div>
    <div class="campo"><label>Descrição (opcional)</label><input name="descricao" type="text" placeholder="Ex.: 40 frangos" value="${esc(d?.descricao ?? pre.descricao)}"></div>
    <div class="campo"><label>Fim de semana</label><select name="fim_de_semana_id">${optsFds(fdsInicial, '— Sem fim de semana (ex.: renda) —')}</select></div>
    ${autor(d)}
    <div class="acoes">
      ${d ? '<button class="btn perigo" type="button" id="apagar-desp">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;

  abrirSheet(d ? 'Editar despesa' : 'Nova despesa', html, el => {
    const form = $('#f-desp', el);
    let escolhidoAMao = !!d || pre.pessoa_id != null;
    form.pessoa_id.onchange = () => { escolhidoAMao = true; };
    form.categoria_id.onchange = () => {
      const cat = Number(form.categoria_id.value);
      form.pessoa_id.innerHTML = optsResponsavel(cat, escolhidoAMao ? form.pessoa_id.value : sugerido(cat));
    };
    form.onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const preco = num(f.get('preco'));
      if (preco == null || Number.isNaN(preco) || preco < 0) return toast('Preço inválido.', true);
      const valores = {
        categoria_id: Number(f.get('categoria_id')),
        pessoa_id: idOuNull(f.get('pessoa_id')),
        data_encomenda: f.get('data_encomenda') || null,
        preco,
        descricao: f.get('descricao').trim() || null,
        fim_de_semana_id: idOuNull(f.get('fim_de_semana_id')),
      };
      acao(async () => {
        const novoId = await guardar('despesas', valores, d?.id);
        if (!d && pre.aoCriar) await pre.aoCriar(novoId);
      }, 'Despesa guardada', voltar);
    };
    if (d) $('#apagar-desp', el).onclick = () => {
      if (confirm('Apagar esta despesa?')) acao(() => apagar('despesas', d.id), 'Despesa apagada', voltar);
    };
  });
}

/* =========================================================
   Evento (formulário)
   ========================================================= */
function abrirEvento(id, data) {
  const e = id ? porId('eventos', id) : null;
  const html = `
  <form id="f-ev">
    <div class="campo"><label>Nome do evento</label><input name="nome" required placeholder="Ex.: Francesinhas" value="${esc(e?.nome)}"></div>
    <div class="campo"><label>Data</label><input name="data" type="date" required value="${e?.data ?? data ?? hojeIso()}"></div>
    <div class="campo"><label>Equipa principal</label><select name="equipa_id">${optsLista('equipas', e?.equipa_id, '— Nenhuma —')}</select></div>
    <label class="campo-check"><input type="checkbox" name="todas_equipas" ${e?.todas_equipas ? 'checked' : ''}> Todas as equipas ajudam</label>
    <div class="campo"><label>Número de pessoas</label><input name="num_pessoas" type="number" min="0" inputmode="numeric" value="${e?.num_pessoas ?? ''}"></div>
    <div class="campo"><label>Lucro (só nota, €)</label><input name="nota_lucro" type="text" inputmode="decimal" value="${e?.nota_lucro ?? ''}"></div>
    <p class="dica">Este valor não entra no lucro total: o dinheiro é contado no lucro final de domingo.</p>
    <div class="campo"><label>Notas</label><textarea name="notas">${esc(e?.notas)}</textarea></div>
    ${autor(e)}
    <div class="acoes">
      ${e ? '<button class="btn perigo" type="button" id="apagar-ev">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(e ? 'Editar evento' : 'Novo evento', html, el => {
    const form = $('#f-ev', el);
    form.onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const lucro = num(f.get('nota_lucro'));
      if (lucro != null && Number.isNaN(lucro)) return toast('Lucro inválido.', true);
      const valores = {
        nome: f.get('nome').trim(),
        data: f.get('data'),
        equipa_id: idOuNull(f.get('equipa_id')),
        todas_equipas: f.get('todas_equipas') === 'on',
        num_pessoas: f.get('num_pessoas') === '' ? null : parseInt(f.get('num_pessoas'), 10),
        nota_lucro: lucro,
        notas: f.get('notas').trim() || null,
      };
      acao(() => guardar('eventos', valores, e?.id), 'Evento guardado');
    };
    if (e) $('#apagar-ev', el).onclick = () => {
      if (confirm(`Apagar o evento "${e.nome}"?`)) acao(() => apagar('eventos', e.id), 'Evento apagado');
    };
  });
}

/* =========================================================
   Vista: Despesas
   ========================================================= */
function vDespesas() {
  let lista = D.despesas;
  if (S.despFds) lista = lista.filter(d => d.fim_de_semana_id === Number(S.despFds));
  if (S.despCat) lista = lista.filter(d => d.categoria_id === Number(S.despCat));

  const grupos = fdsOrdenados()
    .map(f => ({ f, itens: lista.filter(d => d.fim_de_semana_id === f.id) }))
    .filter(g => g.itens.length);
  const semFds = lista.filter(d => d.fim_de_semana_id == null);

  return `
  <div class="filtros">
    <select data-filtro="despFds">${optsFds(S.despFds, 'Todos os fins de semana')}</select>
  </div>
  <div class="filtros">
    <select data-filtro="despCat">${optsLista('categorias_despesa', S.despCat, 'Todas as categorias')}</select>
  </div>
  <div class="cartao"><div class="total-linha" style="margin:0"><span>Total${S.despCat ? ' · ' + esc(porId('categorias_despesa', S.despCat)?.nome) : ''}</span><b>${eur(soma(lista, 'preco'))}</b></div></div>
  ${grupos.length ? grupos.map(g => `
    <div class="grupo-titulo">${fmtFds(g.f.data_sabado)} · ${eur(soma(g.itens, 'preco'))}</div>
    <div class="cartao" style="padding:4px 14px"><ul class="lista">${g.itens.map(linhaDespesa).join('')}</ul></div>`).join('')
    : ''}
  ${semFds.length ? `
    <div class="grupo-titulo">Sem fim de semana · ${eur(soma(semFds, 'preco'))}</div>
    <div class="cartao" style="padding:4px 14px"><ul class="lista">${[...semFds].sort((a, b) => (b.data_encomenda || '').localeCompare(a.data_encomenda || '')).map(linhaDespesa).join('')}</ul></div>` : ''}
  ${!grupos.length && !semFds.length ? '<div class="vazio">Sem despesas para estes filtros.</div>' : ''}
  <button class="fab" data-acao="novaDespesa" data-fds="${esc(S.despFds)}">+ Despesa</button>`;
}

/* =========================================================
   Encomendas: linha, formulário da semana e encomendas fixas
   ========================================================= */
function linhaEncomenda(o) {
  const cat = porId('categorias_despesa', o.categoria_id), p = porId('pessoas', o.pessoa_id);
  const estado = o.removida ? 'removida' : o.encomendada_em ? 'feito' : 'pendente';
  return `<li class="toque enc-linha ${estado}" data-acao="abrirEncomenda" data-key="${o.key}">
    <span class="estado-ponto ${estado}">${o.removida ? '–' : o.encomendada_em ? '✓' : '🛒'}</span>
    <div class="princ"><b>${esc(cat?.nome || 'Encomenda')}</b> <span class="sub">· ${DIAS_SEMANA[diaSemanaDe(o.data) - 1]} ${fmtCurta(o.data)}</span>
      <div class="sub">${esc(textoItens(o.itens) || 'Sem quantidades')}</div>
      <div class="sub">${o.removida ? 'Removida desta semana' : o.encomendada_em ? `Encomendado por ${esc(o.encomendada_por || '—')}` : esc(p?.nome || 'Sem responsável')}</div></div>
    <span class="sub">›</span></li>`;
}

// ---- editor de produtos + quantidades
function optsProduto(catId, sel) {
  const prods = [...D.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const daCat = prods.filter(p => p.categoria_id === Number(catId)), outros = prods.filter(p => !daCat.includes(p));
  let h = opt('', '— Produto —', sel);
  if (daCat.length) {
    h += `<optgroup label="${esc(porId('categorias_despesa', catId)?.nome || '')}">${daCat.map(p => opt(p.id, p.nome, sel)).join('')}</optgroup>`;
    if (outros.length) h += `<optgroup label="Outros">${outros.map(p => opt(p.id, p.nome, sel)).join('')}</optgroup>`;
  } else h += outros.map(p => opt(p.id, p.nome, sel)).join('');
  return h + opt('novo', '+ Novo produto…', '');
}
const linhaItemHtml = (i, catId) => `<div class="item-linha">
  <select class="it-prod">${optsProduto(catId, i.produto_id)}</select>
  <input class="it-qtd" type="text" inputmode="decimal" placeholder="Qtd." value="${i.quantidade != null ? fmtNum.format(i.quantidade) : ''}">
  <button type="button" class="btn peq" data-item="del" aria-label="Remover produto">✕</button></div>`;
const htmlItens = (itens, catId) => `<div class="itens">${(itens?.length ? itens : [{}]).map(i => linhaItemHtml(i, catId)).join('')}</div>
  <button type="button" class="btn peq" data-item="add" style="margin-bottom:12px">+ Produto</button>`;

function montarItens(form, getCat) {
  const cont = $('.itens', form);
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-item]');
    if (!b) return;
    ev.preventDefault();
    if (b.dataset.item === 'add') cont.insertAdjacentHTML('beforeend', linhaItemHtml({}, getCat()));
    else b.closest('.item-linha').remove();
  });
  form.addEventListener('change', async ev => {
    const sel = ev.target;
    if (!sel.classList.contains('it-prod') || sel.value !== 'novo') return;
    const nome = (prompt('Nome do novo produto (ex.: Frango, Costela, Broa):') || '').trim();
    if (!nome) { sel.value = ''; return; }
    try {
      let p = D.produtos.find(x => x.nome.toLowerCase() === nome.toLowerCase());
      if (!p) {
        await guardar('produtos', { nome, categoria_id: idOuNull(getCat()) });
        const r = await sb.from('produtos').select('*').order('id');
        if (r.error) throw r.error;
        D.produtos = r.data;
        p = D.produtos.find(x => x.nome.toLowerCase() === nome.toLowerCase());
        toast('Produto criado');
      }
      form.querySelectorAll('.it-prod').forEach(s2 => {
        const v = s2 === sel ? p.id : (s2.value === 'novo' ? '' : s2.value);
        s2.innerHTML = optsProduto(getCat(), v);
      });
    } catch (e) { sel.value = ''; toast(erroLegivel(e), true); }
  });
}
const atualizarProdutos = (form, cat) => form.querySelectorAll('.it-prod').forEach(s2 => { s2.innerHTML = optsProduto(cat, s2.value); });
function lerItens(form) {
  return [...form.querySelectorAll('.item-linha')].map(l => {
    const v = l.querySelector('.it-prod').value;
    const q = num(l.querySelector('.it-qtd').value);
    return { produto_id: v && v !== 'novo' ? Number(v) : null, quantidade: q != null && !Number.isNaN(q) ? q : null };
  }).filter(i => i.produto_id);
}

// ---- encomenda de uma semana
function guardarEncomenda(oc, alt = {}, acaoTexto) {
  const v = {
    fixa_id: oc.fixa?.id ?? null, fim_de_semana_id: oc.fds.id, categoria_id: oc.categoria_id,
    pessoa_id: oc.pessoa_id, data: oc.data, itens: oc.itens, notas: oc.notas ?? null, ...alt,
  };
  return guardar('encomendas', v, oc.registo?.id, acaoTexto);
}

function abrirEncomenda(key) {
  const oc = ocorrencias().find(o => o.key === key);
  if (!oc) return fecharSheet();
  const cat = porId('categorias_despesa', oc.categoria_id);
  const reabrir = () => {
    const o = ocorrencias().find(x => oc.fixa ? (x.fixa?.id === oc.fixa.id && x.fds.id === oc.fds.id) : x.registo?.id === oc.registo?.id);
    if (o) abrirEncomenda(o.key); else fecharSheet();
  };
  const titulo = `Encomenda · ${cat?.nome || ''}`;
  const semana = `Fim de semana ${fmtFds(oc.fds.data_sabado)}`;

  if (oc.removida) {
    return abrirSheet(titulo, `
      <div class="estado removida">Removida desta semana</div>
      <p class="dica">${semana}. Nas outras semanas a encomenda continua normalmente.</p>
      <div class="acoes"><button class="btn primario" id="repor">Repor esta encomenda</button></div>`, el => {
      $('#repor', el).onclick = () => acao(() => guardarEncomenda(oc, { removida: false }, 'repôs'), 'Encomenda reposta', reabrir);
    });
  }

  const desp = oc.despesa_id ? porId('despesas', oc.despesa_id) : null;
  const html = `
  ${oc.encomendada_em
    ? `<div class="estado feito">✓ Encomendado por <b>${esc(oc.encomendada_por || '—')}</b><span>${fmtQuando(oc.encomendada_em)}</span></div>`
    : `<div class="estado pendente">🛒 Por encomendar · ${DIAS_SEMANA[diaSemanaDe(oc.data) - 1]}, ${fmtCurta(oc.data)}</div>`}
  <form id="f-enc">
    <div class="campo"><label>Dia da encomenda</label><input name="data" type="date" required value="${oc.data}"></div>
    <div class="campo"><label>Responsável</label><select name="pessoa_id">${optsResponsavel(oc.categoria_id, oc.pessoa_id)}</select></div>
    <div class="campo"><label>Quantidades</label></div>
    ${htmlItens(oc.itens, oc.categoria_id)}
    <div class="campo"><label>Notas</label><textarea name="notas">${esc(oc.notas)}</textarea></div>
    <p class="dica">${oc.fixa ? `As alterações valem só para esta semana (${semana.toLowerCase()}).` : semana + '.'}</p>
    <div class="acoes"><button class="btn" type="submit">Guardar</button>
      ${oc.encomendada_em
        ? '<button class="btn" type="button" id="desmarcar">Desmarcar</button>'
        : '<button class="btn primario" type="button" id="marcar">✓ Encomendado</button>'}</div>
    <div class="acoes">${desp
      ? `<button class="btn bloco" type="button" data-acao="editarDespesa" data-id="${desp.id}">Despesa registada: ${eur(desp.preco)}</button>`
      : '<button class="btn bloco" type="button" id="registar-desp">💶 Registar despesa</button>'}</div>
    ${oc.encomendada_em ? '' : '<div class="acoes"><button class="btn perigo bloco" type="button" id="remover-enc">Não encomendar esta semana</button></div>'}
  </form>`;

  abrirSheet(titulo, html, el => {
    const form = $('#f-enc', el);
    montarItens(form, () => oc.categoria_id);
    const valoresForm = () => ({
      data: form.data.value || oc.data,
      pessoa_id: idOuNull(form.pessoa_id.value),
      itens: lerItens(form),
      notas: form.notas.value.trim() || null,
    });
    form.onsubmit = ev => {
      ev.preventDefault();
      acao(() => guardarEncomenda(oc, valoresForm()), 'Encomenda guardada', reabrir);
    };
    $('#marcar', el)?.addEventListener('click', () => {
      const u = utilizadorAtual();
      acao(() => guardarEncomenda(oc, {
        ...valoresForm(), encomendada_em: new Date().toISOString(),
        encomendada_por: u?.nome || 'Desconhecido', encomendada_por_id: u?.id ?? null,
      }, 'marcou como encomendada'), 'Marcado como encomendado', reabrir);
    });
    $('#desmarcar', el)?.addEventListener('click', () => {
      if (confirm('Desmarcar como encomendado?'))
        acao(() => guardarEncomenda(oc, { encomendada_em: null, encomendada_por: null, encomendada_por_id: null }, 'desmarcou'), 'Desmarcado', reabrir);
    });
    $('#remover-enc', el)?.addEventListener('click', () => {
      if (confirm('Não encomendar isto esta semana?'))
        acao(() => guardarEncomenda(oc, { removida: true }, 'removeu da semana'), 'Encomenda removida desta semana', () => abrirFds(oc.fds.data_sabado));
    });
    $('#registar-desp', el)?.addEventListener('click', () => {
      const atual = { ...oc, ...valoresForm() };
      abrirDespesa(null, oc.fds.id, null, {
        categoria_id: oc.categoria_id, pessoa_id: atual.pessoa_id, data_encomenda: atual.data,
        descricao: textoItens(atual.itens),
        aoCriar: async despId => {
          await carregar();
          const o = ocorrencias().find(x => oc.fixa ? (x.fixa?.id === oc.fixa.id && x.fds.id === oc.fds.id) : x.registo?.id === oc.registo?.id) || oc;
          await guardarEncomenda(o, { ...valoresForm(), despesa_id: despId }, 'registou a despesa da encomenda');
        },
        voltar: reabrir,
      });
    });
  });
}

// ---- encomendas fixas (modelo semanal)
function abrirFixa(id) {
  const f = id ? porId('encomendas_fixas', id) : null;
  if (!D.categorias_despesa.length) return toast('Primeiro cria categorias de despesa.', true);
  const cat = f?.categoria_id ?? D.categorias_despesa[0].id;
  const html = `
  <form id="f-fixa">
    <div class="campo"><label>Categoria</label><select name="categoria_id">${optsLista('categorias_despesa', cat)}</select></div>
    <div class="campo"><label>Responsável</label><select name="pessoa_id">${optsResponsavel(cat, f ? f.pessoa_id : sugerido(cat))}</select></div>
    <div class="campo"><label>Dia da encomenda (todas as semanas)</label>
      <select name="dia_semana">${DIAS_SEMANA.map((n, i) => opt(i + 1, n, f?.dia_semana ?? 3)).join('')}</select></div>
    <div class="campo"><label>Quantidades habituais</label></div>
    ${htmlItens(f?.itens, cat)}
    <div class="campo"><label>Notas</label><textarea name="notas" placeholder="Ex.: fornecedor, contacto…">${esc(f?.notas)}</textarea></div>
    ${f ? `<label class="campo-check"><input type="checkbox" name="ativa" ${f.ativa ? 'checked' : ''}> Ativa (aparece no calendário)</label>` : ''}
    <p class="dica">Aparece como lembrete no calendário em todas as semanas que têm fim de semana registado. Em cada semana podes mudar o dia, as quantidades ou removê-la.</p>
    ${autor(f)}
    <div class="acoes">
      ${f ? '<button class="btn perigo" type="button" id="apagar-fixa">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(f ? 'Editar encomenda fixa' : 'Nova encomenda fixa', html, el => {
    const form = $('#f-fixa', el);
    montarItens(form, () => form.categoria_id.value);
    let escolhidoAMao = !!f;
    form.pessoa_id.onchange = () => { escolhidoAMao = true; };
    form.categoria_id.onchange = () => {
      const c = Number(form.categoria_id.value);
      form.pessoa_id.innerHTML = optsResponsavel(c, escolhidoAMao ? form.pessoa_id.value : sugerido(c));
      atualizarProdutos(form, c);
    };
    form.onsubmit = ev => {
      ev.preventDefault();
      acao(() => guardar('encomendas_fixas', {
        categoria_id: Number(form.categoria_id.value),
        pessoa_id: idOuNull(form.pessoa_id.value),
        dia_semana: Number(form.dia_semana.value),
        itens: lerItens(form),
        notas: form.notas.value.trim() || null,
        ativa: f ? form.ativa.checked : true,
      }, f?.id), 'Encomenda fixa guardada');
    };
    if (f) $('#apagar-fixa', el).onclick = () => {
      if (confirm('Apagar esta encomenda fixa? As encomendas já feitas continuam no histórico. (Para parar só por uns tempos, desmarca "Ativa".)'))
        acao(() => apagar('encomendas_fixas', f.id), 'Encomenda fixa apagada');
    };
  });
}

/* =========================================================
   Vista: Festa (cantores, fogo, luzes, palco, extras…)
   ========================================================= */
const hhmm = t => (t || '').slice(0, 5);
const fmtDiaFesta = s => { const t = parse(s).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const festaCats = () => [...D.festa_categorias].sort((a, b) => (a.ordem - b.ordem) || a.id - b.id);
const festaCat = id => porId('festa_categorias', id);

function vFesta() {
  const todos = D.festa_atuacoes;
  const cats = festaCats();
  const resumo = cats.map(c => ({ c, itens: todos.filter(a => a.categoria_id === c.id) })).filter(x => x.itens.length);
  let lista = S.festaCat ? todos.filter(a => String(a.categoria_id) === String(S.festaCat)) : [...todos];
  const ordemCat = a => festaCat(a.categoria_id)?.ordem ?? 99;
  lista.sort((a, b) => a.dia.localeCompare(b.dia)
    || ((a.hora_inicio ? 0 : 1) - (b.hora_inicio ? 0 : 1))
    || (a.hora_inicio || '').localeCompare(b.hora_inicio || '')
    || ordemCat(a) - ordemCat(b));
  const dias = [...new Set(lista.map(a => a.dia))];
  return `
  <div class="cartao">
    <div class="total-linha" style="margin:0 0 6px"><span>Total da festa</span><b>${eur(soma(todos, 'preco'))}</b></div>
    ${resumo.map(x => `<div class="resumo-linha"><span>${esc(x.c.icone || '')} ${esc(x.c.nome)} <span class="sub">(${x.itens.length})</span></span><b>${eur(soma(x.itens, 'preco'))}</b></div>`).join('')}
  </div>
  <div class="pilulas">
    <button class="pilula${!S.festaCat ? ' ativo' : ''}" data-acao="festaCat" data-id="">Tudo</button>
    ${cats.map(c => `<button class="pilula${String(c.id) === String(S.festaCat) ? ' ativo' : ''}" data-acao="festaCat" data-id="${c.id}">${esc(c.icone || '')} ${esc(c.nome)}</button>`).join('')}
  </div>
  ${dias.length ? dias.map(dia => {
    const itens = lista.filter(a => a.dia === dia);
    return `<div class="grupo-titulo">${fmtDiaFesta(dia)} · ${eur(soma(itens, 'preco'))}</div>
      <div class="cartao" style="padding:4px 14px"><ul class="lista">${itens.map(a => {
        const c = festaCat(a.categoria_id), r = porId('festa_responsaveis', a.responsavel_id);
        return `<li class="toque" data-acao="editarAtuacao" data-id="${a.id}">
          <div class="hora">${a.hora_inicio ? `${hhmm(a.hora_inicio)}${a.hora_fim ? `<span>${hhmm(a.hora_fim)}</span>` : ''}` : `<span class="ico">${esc(c?.icone || '•')}</span>`}</div>
          <div class="princ"><b>${a.hora_inicio && c?.icone ? esc(c.icone) + ' ' : ''}${esc(a.artista)}</b>
            <div class="sub">${esc(c?.nome || 'Sem categoria')}${r ? ' · ' + esc(r.nome) : ''}</div>
            ${a.notas ? `<div class="sub">${esc(a.notas)}</div>` : ''}${autor(a)}</div>
          <span class="valor">${a.preco != null ? eur(a.preco) : ''}</span></li>`;
      }).join('')}</ul></div>`;
  }).join('') : '<div class="vazio">Ainda não há nada registado. Carrega em "+ Adicionar".</div>'}
  <button class="fab" data-acao="novoFestaItem">+ Adicionar</button>`;
}

function escolherCategoriaFesta() {
  const cats = festaCats();
  abrirSheet('Adicionar à festa', `
    <div class="grelha-cats">${cats.map(c => `
      <button class="cat-btn" data-acao="novoFestaCat" data-cat="${c.id}"><span>${esc(c.icone || '➕')}</span>${esc(c.nome)}</button>`).join('')}</div>
    <p class="dica" style="margin-top:12px">Para criar outras categorias ou responsáveis vai a Listas → Configuração.</p>`);
}

function abrirAtuacao(id, catId) {
  const a = id ? porId('festa_atuacoes', id) : null;
  const cat = a?.categoria_id ?? catId ?? festaCats()[0]?.id ?? '';
  const ultimoDia = [...D.festa_atuacoes].sort((x, y) => y.id - x.id)[0]?.dia || '';
  const rotuloNome = c => festaCat(c)?.tem_horario ? 'Cantor / artista' : 'Descrição';
  const html = `
  <form id="f-at">
    <div class="campo"><label>Categoria</label><select name="categoria_id">${festaCats().map(c => opt(c.id, `${c.icone || ''} ${c.nome}`.trim(), cat)).join('')}</select></div>
    <div class="campo"><label id="rot-nome">${rotuloNome(cat)}</label><input name="artista" required placeholder="Ex.: nome, empresa ou o que é" value="${esc(a?.artista)}"></div>
    <div class="campo"><label>Dia</label><input name="dia" type="date" required value="${a?.dia ?? ultimoDia}"></div>
    <div class="filtros" id="horas" ${festaCat(cat)?.tem_horario ? '' : 'hidden'}>
      <div class="campo" style="flex:1"><label>Começa</label><input name="hora_inicio" type="time" value="${hhmm(a?.hora_inicio)}"></div>
      <div class="campo" style="flex:1"><label>Acaba</label><input name="hora_fim" type="time" value="${hhmm(a?.hora_fim)}"></div>
    </div>
    <div class="campo"><label>Preço (€)</label><input name="preco" type="text" inputmode="decimal" placeholder="0,00" value="${a?.preco ?? ''}"></div>
    <div class="campo"><label>Responsável</label><select name="responsavel_id">${optsLista('festa_responsaveis', a?.responsavel_id, '— Sem responsável —')}</select></div>
    <div class="campo"><label>Notas</label><textarea name="notas" placeholder="Ex.: contacto, sinal pago, o que inclui…">${esc(a?.notas)}</textarea></div>
    ${autor(a)}
    <div class="acoes">
      ${a ? '<button class="btn perigo" type="button" id="apagar-at">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(a ? 'Editar' : `Adicionar · ${festaCat(cat)?.nome || ''}`, html, el => {
    const form = $('#f-at', el);
    form.categoria_id.onchange = () => {
      const c = form.categoria_id.value;
      $('#horas', el).hidden = !festaCat(c)?.tem_horario;
      $('#rot-nome', el).textContent = rotuloNome(c);
    };
    form.onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const preco = num(f.get('preco'));
      if (preco != null && (Number.isNaN(preco) || preco < 0)) return toast('Preço inválido.', true);
      const comHoras = !!festaCat(f.get('categoria_id'))?.tem_horario;
      acao(() => guardar('festa_atuacoes', {
        categoria_id: idOuNull(f.get('categoria_id')),
        artista: f.get('artista').trim(),
        dia: f.get('dia'),
        hora_inicio: comHoras ? (f.get('hora_inicio') || null) : null,
        hora_fim: comHoras ? (f.get('hora_fim') || null) : null,
        preco,
        responsavel_id: idOuNull(f.get('responsavel_id')),
        notas: f.get('notas').trim() || null,
      }, a?.id), 'Guardado');
    };
    if (a) $('#apagar-at', el).onclick = () => {
      if (confirm(`Apagar "${a.artista}"?`)) acao(() => apagar('festa_atuacoes', a.id), 'Apagado');
    };
  });
}

/* =========================================================
   Tarefas (cartão na página principal)
   ========================================================= */
const ESTADOS_TAREFA = { por_fazer: 'Por fazer', a_tratar: 'A tratar', feita: 'Feita' };
const ICONE_TAREFA = { por_fazer: '○', a_tratar: '◐', feita: '✓' };

function cartaoTarefas() {
  const hoje = hojeIso();
  const eu = utilizadorAtual();
  let lista = [...D.tarefas];
  if (S.tarefasVer === 'feitas') lista = lista.filter(t => t.estado === 'feita')
    .sort((a, b) => (b.feita_em || '').localeCompare(a.feita_em || ''));
  else {
    lista = lista.filter(t => t.estado !== 'feita');
    if (S.tarefasVer === 'minhas') lista = lista.filter(t => eu?.pessoa_id && t.pessoa_id === eu.pessoa_id);
    lista.sort((a, b) => (a.dia || '9999').localeCompare(b.dia || '9999') || a.id - b.id);
  }
  const abertas = D.tarefas.filter(t => t.estado !== 'feita').length;
  const pil = (k, t) => `<button class="pilula${S.tarefasVer === k ? ' ativo' : ''}" data-acao="tarefasVer" data-ver="${k}">${t}</button>`;
  return `<div class="cartao">
    <div class="cartao-topo"><h3>Tarefas ${abertas ? `<span class="etiqueta pendente">${abertas} por fazer</span>` : ''}</h3>
      <button class="btn peq primario" data-acao="novaTarefa">+ Tarefa</button></div>
    <div class="pilulas">${pil('abertas', 'Por fazer')}${eu?.pessoa_id ? pil('minhas', 'As minhas') : ''}${pil('feitas', 'Feitas')}</div>
    ${lista.length ? `<ul class="lista">${lista.map(t => {
      const p = porId('pessoas', t.pessoa_id);
      const atrasada = t.estado !== 'feita' && t.dia && t.dia < hoje;
      return `<li class="toque tarefa ${t.estado}" data-acao="editarTarefa" data-id="${t.id}">
        <span class="estado-ponto t-${t.estado}">${ICONE_TAREFA[t.estado]}</span>
        <div class="princ"><b>${esc(t.nome)}</b>
          ${t.descricao ? `<div class="sub desc">${esc(t.descricao)}</div>` : ''}
          <div class="sub">${esc(p?.nome || 'Sem responsável')}${t.dia ? ` · <span class="${atrasada ? 'atrasada' : ''}">${atrasada ? 'Atrasada · ' : ''}${fmtCurta(t.dia)}</span>` : ''} · ${ESTADOS_TAREFA[t.estado]}</div>
          ${t.estado === 'feita' && t.feita_por ? `<div class="autor">Feita por ${esc(t.feita_por)}</div>` : autor(t)}</div>
        <span class="sub">›</span></li>`;
    }).join('')}</ul>` : `<div class="vazio">${S.tarefasVer === 'feitas' ? 'Ainda não há tarefas feitas.' : 'Não há tarefas por fazer. 🎉'}</div>`}
  </div>`;
}

function abrirTarefa(id) {
  const t = id ? porId('tarefas', id) : null;
  const estado = t?.estado ?? 'por_fazer';
  const html = `
  <form id="f-tar">
    <div class="campo"><label>Nome</label><input name="nome" required placeholder="Ex.: Pedir licença à Câmara" value="${esc(t?.nome)}"></div>
    <div class="campo"><label>Descrição</label><textarea name="descricao" placeholder="Detalhes, contactos, o que falta…">${esc(t?.descricao)}</textarea></div>
    <div class="campo"><label>Quem vai tratar</label><select name="pessoa_id">${opt('', '— Ninguém ainda —', t?.pessoa_id ?? '')}${[...D.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map(p => opt(p.id, p.nome, t?.pessoa_id ?? utilizadorAtual()?.pessoa_id ?? '')).join('')}</select></div>
    <div class="campo"><label>Dia</label><input name="dia" type="date" value="${t?.dia ?? ''}"></div>
    <div class="campo"><label>Estado</label>
      <div class="escolha">${Object.entries(ESTADOS_TAREFA).map(([k, n]) => `
        <label><input type="radio" name="estado" value="${k}" ${estado === k ? 'checked' : ''}><span>${ICONE_TAREFA[k]} ${n}</span></label>`).join('')}</div></div>
    ${t?.estado === 'feita' && t.feita_por ? `<div class="autor">Feita por ${esc(t.feita_por)} · ${fmtQuando(t.feita_em)}</div>` : ''}
    ${autor(t)}
    <div class="acoes">
      ${t ? '<button class="btn perigo" type="button" id="apagar-tar">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(t ? 'Editar tarefa' : 'Nova tarefa', html, el => {
    const form = $('#f-tar', el);
    form.onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(form);
      const novo = f.get('estado');
      const v = {
        nome: f.get('nome').trim(),
        descricao: f.get('descricao').trim() || null,
        pessoa_id: idOuNull(f.get('pessoa_id')),
        dia: f.get('dia') || null,
        estado: novo,
      };
      let acaoTexto;
      if (novo === 'feita' && t?.estado !== 'feita') {
        v.feita_por = utilizadorAtual()?.nome ?? null; v.feita_em = new Date().toISOString(); acaoTexto = 'marcou como feita';
      } else if (novo !== 'feita' && t?.estado === 'feita') { v.feita_por = null; v.feita_em = null; }
      if (t && novo === 'a_tratar' && t.estado !== 'a_tratar') acaoTexto = 'começou a tratar';
      acao(() => guardar('tarefas', v, t?.id, t ? acaoTexto : undefined), 'Tarefa guardada');
    };
    if (t) $('#apagar-tar', el).onclick = () => {
      if (confirm(`Apagar a tarefa "${t.nome}"?`)) acao(() => apagar('tarefas', t.id), 'Tarefa apagada');
    };
  });
}

/* =========================================================
   Patrocínios (separador em Listas)
   ========================================================= */
const nomeEventoPatroc = p => p.evento_id ? (porId('eventos', p.evento_id)?.nome || 'Evento apagado') : (p.evento_texto || '');

function vPatrocinios() {
  const todos = D.patrocinios;
  const totalDinheiro = soma(todos.filter(p => p.tipo === 'dinheiro'), 'valor');
  const patrocinadores = new Set(todos.map(p => p.nome.trim().toLowerCase())).size;
  let lista = [...todos];
  if (S.patTipo) lista = lista.filter(p => p.tipo === S.patTipo);
  let totalProd = 0;
  if (S.patProd) {
    const pid = Number(S.patProd);
    lista = lista.filter(p => p.tipo === 'generos' && (p.itens || []).some(i => i.produto_id === pid));
    totalProd = lista.reduce((t, p) => t + p.itens.filter(i => i.produto_id === pid).reduce((s2, i) => s2 + (Number(i.quantidade) || 0), 0), 0);
  }
  lista.sort((a, b) => (b.dia || '').localeCompare(a.dia || '') || b.id - a.id);
  return `
  <div class="grelha">
    <div class="cartao"><div class="kpi-rotulo">Total em dinheiro</div><div class="kpi-valor pos">${eur(totalDinheiro)}</div></div>
    <div class="cartao"><div class="kpi-rotulo">Patrocinadores</div><div class="kpi-valor">${patrocinadores}</div></div>
  </div>
  <p class="dica">O dinheiro dos patrocínios fica separado do lucro dos fins de semana. O total junto está em Configuração → Dinheiro total da festa.</p>
  <div class="filtros">
    <select data-filtro="patTipo">${opt('', 'Dinheiro e géneros', S.patTipo)}${opt('dinheiro', '💶 Só dinheiro', S.patTipo)}${opt('generos', '🥩 Só géneros', S.patTipo)}</select>
    <select data-filtro="patProd">${optsLista('produtos', S.patProd, 'Todos os produtos')}</select>
  </div>
  ${S.patProd ? `<div class="cartao"><div class="total-linha" style="margin:0"><span>Total de ${esc(nomeProduto(S.patProd))} oferecido</span><b>${fmtNum.format(totalProd)}</b></div>
    <div class="sub" style="font-size:13px;color:var(--suave)">em ${lista.length} patrocínio(s)</div></div>` : ''}
  ${lista.length ? `<div class="cartao" style="padding:4px 14px"><ul class="lista">${lista.map(p => `
    <li class="toque" data-acao="editarPatrocinio" data-id="${p.id}">
      <span class="estado-ponto">${p.tipo === 'dinheiro' ? '💶' : '🥩'}</span>
      <div class="princ"><b>${esc(p.nome)}</b>
        ${p.tipo === 'generos' ? `<div class="sub">${esc(textoItens(p.itens) || 'Géneros')}</div>` : ''}
        <div class="sub">${[nomeEventoPatroc(p), p.dia ? fmtCurta(p.dia) : ''].filter(Boolean).map(esc).join(' · ') || 'Sem evento'}</div>
        ${autor(p)}</div>
      <span class="valor">${p.tipo === 'dinheiro' ? eur(p.valor) : ''}</span></li>`).join('')}</ul></div>`
    : '<div class="vazio">Ainda não há patrocínios.</div>'}
  <button class="fab" data-acao="novoPatrocinio">+ Patrocínio</button>`;
}

function abrirPatrocinio(id) {
  const p = id ? porId('patrocinios', id) : null;
  const tipo = p?.tipo ?? 'dinheiro';
  const eventos = [...D.eventos].sort((a, b) => b.data.localeCompare(a.data));
  const eventoSel = p ? (p.evento_id ?? (p.evento_texto ? 'outro' : '')) : '';
  const nomes = [...new Set(D.patrocinios.map(x => x.nome))].sort((a, b) => a.localeCompare(b, 'pt'));
  const html = `
  <form id="f-pat">
    <div class="campo"><label>Quem patrocina</label><input name="nome" required list="nomes-patroc" placeholder="Nome da pessoa ou empresa" value="${esc(p?.nome)}">
      <datalist id="nomes-patroc">${nomes.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
    <div class="campo"><label>Tipo</label>
      <div class="escolha">
        <label><input type="radio" name="tipo" value="dinheiro" ${tipo === 'dinheiro' ? 'checked' : ''}><span>💶 Dinheiro</span></label>
        <label><input type="radio" name="tipo" value="generos" ${tipo === 'generos' ? 'checked' : ''}><span>🥩 Géneros</span></label>
      </div></div>
    <div id="bloco-dinheiro" ${tipo === 'dinheiro' ? '' : 'hidden'}>
      <div class="campo"><label>Valor (€)</label><input name="valor" type="text" inputmode="decimal" placeholder="0,00" value="${p?.valor ?? ''}"></div>
    </div>
    <div id="bloco-generos" ${tipo === 'generos' ? '' : 'hidden'}>
      <div class="campo"><label>O que deu</label></div>
      ${htmlItens(p?.itens, '')}
    </div>
    <div class="campo"><label>Evento patrocinado</label>
      <select name="evento">${opt('', '— Nenhum —', eventoSel)}${eventos.map(e => opt(e.id, `${e.nome} · ${fmtCurta(e.data)}`, eventoSel)).join('')}${opt('outro', '✏️ Outro evento (escrever)', eventoSel)}</select></div>
    <div class="campo" id="bloco-evento-texto" ${eventoSel === 'outro' ? '' : 'hidden'}>
      <input name="evento_texto" placeholder="Nome do evento" value="${esc(p?.evento_texto)}">
      <p class="dica" style="margin:6px 0 0">Fica só no patrocínio: não aparece no calendário nem nos eventos.</p></div>
    <div class="campo"><label>Dia</label><input name="dia" type="date" value="${p?.dia ?? hojeIso()}"></div>
    ${autor(p)}
    <div class="acoes">
      ${p ? '<button class="btn perigo" type="button" id="apagar-pat">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(p ? 'Editar patrocínio' : 'Novo patrocínio', html, el => {
    const form = $('#f-pat', el);
    montarItens(form, () => '');
    form.querySelectorAll('input[name=tipo]').forEach(r => r.onchange = () => {
      const t = form.querySelector('input[name=tipo]:checked').value;
      $('#bloco-dinheiro', el).hidden = t !== 'dinheiro';
      $('#bloco-generos', el).hidden = t !== 'generos';
    });
    form.evento.onchange = () => { $('#bloco-evento-texto', el).hidden = form.evento.value !== 'outro'; };
    form.onsubmit = ev => {
      ev.preventDefault();
      const t = form.querySelector('input[name=tipo]:checked').value;
      const v = { nome: form.nome.value.trim(), tipo: t, dia: form.dia.value || null, evento_id: null, evento_texto: null };
      if (form.evento.value === 'outro') {
        v.evento_texto = form.evento_texto.value.trim() || null;
        if (!v.evento_texto) return toast('Escreve o nome do evento.', true);
      } else v.evento_id = idOuNull(form.evento.value);
      if (t === 'dinheiro') {
        const valor = num(form.valor.value);
        if (valor == null || Number.isNaN(valor) || valor < 0) return toast('Valor inválido.', true);
        v.valor = valor; v.itens = [];
      } else {
        v.itens = lerItens(form); v.valor = null;
        if (!v.itens.length) return toast('Escolhe pelo menos um produto.', true);
      }
      acao(() => guardar('patrocinios', v, p?.id), 'Patrocínio guardado');
    };
    if (p) $('#apagar-pat', el).onclick = () => {
      if (confirm(`Apagar o patrocínio de ${p.nome}?`)) acao(() => apagar('patrocinios', p.id), 'Patrocínio apagado');
    };
  });
}

/* =========================================================
   Vista: Equipas (equipas + pessoas)
   ========================================================= */
function linhaPessoa(p) {
  const fn = porId('funcoes', p.funcao_id), r = porId('responsabilidades', p.responsabilidade_id);
  return `<li class="toque" data-acao="editarPessoa" data-id="${p.id}">
    <div class="princ"><b>${esc(p.nome)}</b><div class="sub">${esc(fn?.nome || 'Sem função')} · Resp.: ${esc(r?.nome || 'nenhuma')}</div>${autor(p)}</div>
    <span class="sub">›</span></li>`;
}

function vEquipas() {
  const ord = l => [...l].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const semEquipa = ord(D.pessoas.filter(p => !equipa(p.equipa_id)));
  return `
  ${D.equipas.map(e => {
    const membros = ord(D.pessoas.filter(p => p.equipa_id === e.id));
    return `<div class="cartao">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span class="ponto" style="--c:${esc(e.cor)};width:16px;height:16px"></span>
        <h3 style="margin:0;flex:1">${esc(e.nome)} <span class="sub" style="font-weight:400">· ${membros.length}</span></h3>
        <button class="btn peq" data-acao="editarEquipa" data-id="${e.id}">Editar</button>
      </div>
      ${membros.length ? `<ul class="lista">${membros.map(linhaPessoa).join('')}</ul>` : '<div class="vazio">Sem pessoas.</div>'}
      <div class="acoes"><button class="btn bloco peq" data-acao="novaPessoa" data-equipa="${e.id}">+ Pessoa</button></div>
    </div>`;
  }).join('')}
  ${semEquipa.length ? `<div class="cartao"><h3>Sem equipa</h3><ul class="lista">${semEquipa.map(linhaPessoa).join('')}</ul></div>` : ''}
  <button class="btn bloco" data-acao="novaEquipa">+ Nova equipa</button>`;
}

function abrirEquipa(id) {
  const e = id ? equipa(id) : null;
  const cores = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04'];
  const html = `
  <form id="f-eq">
    <div class="campo"><label>Nome</label><input name="nome" required value="${esc(e?.nome)}" placeholder="Ex.: Equipa 4"></div>
    <div class="campo"><label>Cor</label><input name="cor" type="color" value="${esc(e?.cor || cores[D.equipas.length % cores.length])}"></div>
    <div class="acoes">
      ${e ? '<button class="btn perigo" type="button" id="apagar-eq">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(e ? 'Editar equipa' : 'Nova equipa', html, el => {
    const form = $('#f-eq', el);
    form.onsubmit = ev => {
      ev.preventDefault();
      acao(() => guardar('equipas', { nome: form.nome.value.trim(), cor: form.cor.value }, e?.id), 'Equipa guardada');
    };
    if (e) $('#apagar-eq', el).onclick = () => {
      if (confirm(`Apagar "${e.nome}"? As pessoas ficam sem equipa e os fins de semana sem equipa atribuída.`))
        acao(() => apagar('equipas', e.id), 'Equipa apagada');
    };
  });
}

function abrirPessoa(id, equipaId) {
  const p = id ? porId('pessoas', id) : null;
  const html = `
  <form id="f-pes">
    <div class="campo"><label>Nome</label><input name="nome" required value="${esc(p?.nome)}" placeholder="Ex.: Lara Ribeiro"></div>
    <div class="campo"><label>Equipa</label><select name="equipa_id">${optsLista('equipas', p?.equipa_id ?? equipaId, '— Sem equipa —')}</select></div>
    <div class="campo"><label>Função</label><select name="funcao_id">${optsLista('funcoes', p?.funcao_id, '— Sem função —')}</select></div>
    <div class="campo"><label>Responsabilidade</label><select name="responsabilidade_id">${optsLista('responsabilidades', p?.responsabilidade_id, 'Nenhuma')}</select></div>
    ${autor(p)}
    <div class="acoes">
      ${p ? '<button class="btn perigo" type="button" id="apagar-pes">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(p ? 'Editar pessoa' : 'Nova pessoa', html, el => {
    const form = $('#f-pes', el);
    form.onsubmit = ev => {
      ev.preventDefault();
      const f = new FormData(form);
      acao(() => guardar('pessoas', {
        nome: f.get('nome').trim(),
        equipa_id: idOuNull(f.get('equipa_id')),
        funcao_id: idOuNull(f.get('funcao_id')),
        responsabilidade_id: idOuNull(f.get('responsabilidade_id')),
      }, p?.id), 'Pessoa guardada');
    };
    if (p) $('#apagar-pes', el).onclick = () => {
      if (confirm(`Apagar ${p.nome}? As despesas dela ficam sem responsável.`)) acao(() => apagar('pessoas', p.id), 'Pessoa apagada');
    };
  });
}

/* =========================================================
   Vista: Listas (funções, responsabilidades, categorias)
   ========================================================= */
const LISTAS = {
  funcoes: { titulo: 'Funções', exemplo: 'Ex.: Caixa' },
  responsabilidades: { titulo: 'Responsabilidades', exemplo: 'Ex.: Carne' },
  categorias_despesa: { titulo: 'Categorias de despesa', exemplo: 'Ex.: Carne' },
  produtos: { titulo: 'Produtos (encomendas)', exemplo: 'Ex.: Frango' },
  festa_categorias: { titulo: 'Categorias da festa', exemplo: 'Ex.: Fogo' },
  festa_responsaveis: { titulo: 'Responsáveis da festa', exemplo: 'Ex.: Ricardo (Agência)' },
};

const fmtQuando = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
};

function vListas() {
  const secs = [['despesas', 'Despesas'], ['encomendas', 'Encomendas'], ['patrocinios', 'Patrocínios'], ['config', 'Configuração']];
  return `<div class="segmentos">${secs.map(([k, t]) =>
    `<button class="seg${S.listaSec === k ? ' ativo' : ''}" data-acao="listaSec" data-sec="${k}">${t}</button>`).join('')}</div>`
    + (S.listaSec === 'despesas' ? vDespesas() : S.listaSec === 'encomendas' ? vEncomendas()
      : S.listaSec === 'patrocinios' ? vPatrocinios() : vConfig());
}

function vEncomendas() {
  const fixas = [...D.encomendas_fixas].sort((a, b) => (b.ativa - a.ativa) || a.dia_semana - b.dia_semana);
  let feitas = ocorrencias().filter(o => o.encomendada_em && !o.removida);
  if (S.encCat) feitas = feitas.filter(o => o.categoria_id === Number(S.encCat));
  if (S.encFds) feitas = feitas.filter(o => o.fds.id === Number(S.encFds));
  let totalProd = 0;
  if (S.encProd) {
    const pid = Number(S.encProd);
    feitas = feitas.filter(o => o.itens.some(i => i.produto_id === pid));
    totalProd = feitas.reduce((t, o) => t + o.itens.filter(i => i.produto_id === pid).reduce((s2, i) => s2 + (Number(i.quantidade) || 0), 0), 0);
  }
  feitas.sort((a, b) => b.data.localeCompare(a.data));
  return `
  <div class="cartao">
    <h3>Encomendas fixas</h3>
    <p class="dica">Aparecem no calendário em todas as semanas com fim de semana registado.</p>
    ${fixas.length ? `<ul class="lista">${fixas.map(f => `
      <li class="toque${f.ativa ? '' : ' inativa'}" data-acao="editarFixa" data-id="${f.id}">
        <div class="princ"><b>${esc(porId('categorias_despesa', f.categoria_id)?.nome)}</b> <span class="sub">· todas as ${DIAS_SEMANA[f.dia_semana - 1].toLowerCase()}s${f.ativa ? '' : ' (desativada)'}</span>
          <div class="sub">${esc(textoItens(f.itens) || 'Sem quantidades')}</div>
          <div class="sub">${esc(porId('pessoas', f.pessoa_id)?.nome || 'Sem responsável')}</div>${autor(f)}</div>
        <span class="sub">›</span></li>`).join('')}</ul>` : '<div class="vazio">Ainda não há encomendas fixas.</div>'}
    <div class="acoes"><button class="btn bloco peq" data-acao="novaFixa">+ Encomenda fixa</button></div>
  </div>
  <div class="grupo-titulo">Encomendas feitas</div>
  <div class="filtros"><select data-filtro="encProd">${optsLista('produtos', S.encProd, 'Todos os produtos')}</select></div>
  <div class="filtros">
    <select data-filtro="encCat">${optsLista('categorias_despesa', S.encCat, 'Todas as categorias')}</select>
    <select data-filtro="encFds">${optsFds(S.encFds, 'Todos os fins de semana')}</select>
  </div>
  ${S.encProd ? `<div class="cartao"><div class="total-linha" style="margin:0"><span>Total de ${esc(nomeProduto(S.encProd))}</span><b>${fmtNum.format(totalProd)}</b></div>
    <div class="sub" style="font-size:13px;color:var(--suave)">em ${feitas.length} encomenda(s)</div></div>` : ''}
  ${feitas.length ? `<div class="cartao" style="padding:4px 14px"><ul class="lista">${feitas.map(linhaEncomenda).join('')}</ul></div>`
    : '<div class="vazio">Ainda não há encomendas feitas com estes filtros.</div>'}`;
}

function vConfig() {
  const eu = utilizadorAtual();
  const utilizadores = [...D.utilizadores].sort((a, b) => (b.ultimo_acesso || '').localeCompare(a.ultimo_acesso || ''));
  return `
    <div class="cartao">
      <h3>Neste aparelho</h3>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="princ" style="flex:1"><b>${esc(eu?.nome || '—')}</b><div class="sub" style="font-size:13px;color:var(--suave)">${esc(eu?.aparelho || '')}</div></div>
        <button class="btn peq" data-acao="mudarUtilizador">Mudar</button>
      </div>
    </div>
    <div class="cartao">
      <h3>Utilizadores (${utilizadores.length})</h3>
      <ul class="lista">${utilizadores.map(u => `
        <li><div class="princ"><b>${esc(u.nome)}</b>${u.id === eu?.id ? ' <span class="sub">(tu)</span>' : ''}<div class="sub">${esc(u.aparelho || 'Aparelho')} · último acesso ${u.ultimo_acesso ? fmtQuando(u.ultimo_acesso) : '—'}</div></div></li>`).join('')}</ul>
    </div>
` + Object.entries(LISTAS).map(([t, cfg]) => `
    <div class="cartao">
      <h3>${cfg.titulo}</h3>
      ${D[t].length ? `<ul class="lista">${(t === 'festa_categorias' ? festaCats() : [...D[t]].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))).map(x => `
        <li class="toque" data-acao="editarItem" data-tabela="${t}" data-id="${x.id}">
          <div class="princ">${t === 'festa_categorias' ? esc(x.icone || '') + ' ' : ''}${esc(x.nome)}${t === 'festa_categorias'
            ? `<div class="sub">${x.tem_horario ? 'Com horário' : 'Sem horário'}</div>` : ''}${t === 'produtos' && x.categoria_id
            ? `<div class="sub">Categoria: ${esc(porId('categorias_despesa', x.categoria_id)?.nome)}</div>` : ''}${t === 'categorias_despesa' && x.responsabilidade_id
            ? `<div class="sub">Responsabilidade: ${esc(porId('responsabilidades', x.responsabilidade_id)?.nome)}</div>` : ''}${t === 'categorias_despesa' && x.total_a_pagar != null
            ? `<div class="sub">Total a pagar: ${eur(x.total_a_pagar)}</div>` : ''}</div>
          <span class="sub">›</span></li>`).join('')}</ul>` : '<div class="vazio">Lista vazia.</div>'}
      <div class="acoes"><button class="btn bloco peq" data-acao="novoItem" data-tabela="${t}">+ Adicionar</button></div>
    </div>`).join('') + (() => {
      const lucro = soma(D.fins_de_semana, 'lucro_final');
      const patroc = soma(D.patrocinios.filter(p => p.tipo === 'dinheiro'), 'valor');
      return `
    <div class="cartao">
      <h3>Dinheiro total da festa</h3>
      <div class="resumo-linha"><span>Lucro dos fins de semana</span><b>${eur(lucro)}</b></div>
      <div class="resumo-linha"><span>Patrocínios em dinheiro</span><b>${eur(patroc)}</b></div>
      <div class="total-linha" style="margin:8px 0 0"><span>Total</span><b class="pos">${eur(lucro + patroc)}</b></div>
    </div>`;
    })() + `
    <button class="btn bloco perigo" data-acao="sair" style="margin-top:8px">Terminar sessão</button>`;
}

function abrirItem(tabela, id) {
  const cfg = LISTAS[tabela], x = id ? porId(tabela, id) : null;
  const html = `
  <form id="f-item">
    <div class="campo"><label>Nome</label><input name="nome" required value="${esc(x?.nome)}" placeholder="${cfg.exemplo}"></div>
    ${tabela === 'categorias_despesa' ? `
      <div class="campo"><label>Responsabilidade ligada (opcional)</label>
        <select name="responsabilidade_id">${optsLista('responsabilidades', x?.responsabilidade_id, 'Nenhuma')}</select></div>
      <p class="dica">Nas despesas desta categoria, as pessoas com esta responsabilidade aparecem primeiro.</p>
      <div class="campo"><label>Valor total a pagar (opcional, €)</label>
        <input name="total_a_pagar" type="text" inputmode="decimal" placeholder="Ex.: 1800 para a renda" value="${x?.total_a_pagar ?? ''}"></div>
      <p class="dica">Se preencheres, a dashboard mostra quanto já foi pago e quanto falta pagar nesta categoria.</p>` : ''}
    ${tabela === 'produtos' ? `
      <div class="campo"><label>Categoria (opcional)</label>
        <select name="categoria_id">${optsLista('categorias_despesa', x?.categoria_id, 'Nenhuma')}</select></div>
      <p class="dica">Nas encomendas desta categoria, este produto aparece primeiro.</p>` : ''}
    ${tabela === 'festa_categorias' ? `
      <div class="campo"><label>Ícone (emoji, opcional)</label><input name="icone" maxlength="4" placeholder="Ex.: 🎆" value="${esc(x?.icone)}"></div>
      <label class="campo-check"><input type="checkbox" name="tem_horario" ${x?.tem_horario ? 'checked' : ''}> Tem horário (hora de início e fim)</label>` : ''}
    <div class="acoes">
      ${x ? '<button class="btn perigo" type="button" id="apagar-item">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;
  abrirSheet(`${x ? 'Editar' : 'Adicionar'} · ${cfg.titulo}`, html, el => {
    const form = $('#f-item', el);
    form.onsubmit = ev => {
      ev.preventDefault();
      const v = { nome: form.nome.value.trim() };
      if (tabela === 'categorias_despesa') {
        v.responsabilidade_id = idOuNull(form.responsabilidade_id.value);
        const t = num(form.total_a_pagar.value);
        if (t != null && (Number.isNaN(t) || t < 0)) return toast('Valor total inválido.', true);
        v.total_a_pagar = t;
      }
      if (tabela === 'produtos') v.categoria_id = idOuNull(form.categoria_id.value);
      if (tabela === 'festa_categorias') {
        v.icone = form.icone.value.trim() || null;
        v.tem_horario = form.tem_horario.checked;
        if (!x) v.ordem = Math.max(0, ...D.festa_categorias.map(c => c.ordem || 0)) + 1;
      }
      acao(() => guardar(tabela, v, x?.id), 'Guardado');
    };
    if (x) $('#apagar-item', el).onclick = () => {
      if (confirm(`Apagar "${x.nome}"?`)) acao(() => apagar(tabela, x.id), 'Apagado');
    };
  });
}

/* =========================================================
   Eventos de clique e filtros
   ========================================================= */
const ACOES = {
  fecharSheet: () => fecharSheet(),
  abrirDia: el => abrirDia(el.dataset.data),
  abrirFds: el => abrirFds(el.dataset.sab),
  apagarFds: el => {
    if (confirm('Apagar este fim de semana? As despesas dele também são apagadas.'))
      acao(() => apagar('fins_de_semana', Number(el.dataset.id)), 'Fim de semana apagado');
  },
  novoEvento: el => abrirEvento(null, el.dataset.data),
  editarEvento: el => abrirEvento(Number(el.dataset.id)),
  novaDespesa: el => abrirDespesa(null, el.dataset.fds ? Number(el.dataset.fds) : null, el.dataset.volta),
  editarDespesa: el => {
    const voltaSab = el.closest('#sheet-corpo') ? fdsDaDespesa(Number(el.dataset.id)) : null;
    abrirDespesa(Number(el.dataset.id), null, voltaSab);
  },
  novoFestaItem: () => escolherCategoriaFesta(),
  novoFestaCat: el => abrirAtuacao(null, Number(el.dataset.cat)),
  editarAtuacao: el => abrirAtuacao(Number(el.dataset.id)),
  festaCat: el => { S.festaCat = el.dataset.id; render(); },
  abrirEncomenda: el => abrirEncomenda(el.dataset.key),
  novaFixa: () => abrirFixa(null),
  editarFixa: el => abrirFixa(Number(el.dataset.id)),
  removerSemana: el => {
    const fdsId = Number(el.dataset.fds), fds = porId('fins_de_semana', fdsId);
    if (!confirm('Remover todas as encomendas por fazer desta semana?')) return;
    acao(async () => {
      for (const o of ocorrencias().filter(x => x.fds.id === fdsId && !x.removida && !x.encomendada_em))
        await guardarEncomenda(o, { removida: true }, 'removeu da semana');
    }, 'Encomendas da semana removidas', () => abrirFds(fds.data_sabado));
  },
  novaTarefa: () => abrirTarefa(null),
  editarTarefa: el => abrirTarefa(Number(el.dataset.id)),
  tarefasVer: el => { S.tarefasVer = el.dataset.ver; render(); },
  novoPatrocinio: () => abrirPatrocinio(null),
  editarPatrocinio: el => abrirPatrocinio(Number(el.dataset.id)),
  listaSec: el => { S.listaSec = el.dataset.sec; render(); window.scrollTo(0, 0); },
  novaEquipa: () => abrirEquipa(null),
  editarEquipa: el => abrirEquipa(Number(el.dataset.id)),
  novaPessoa: el => abrirPessoa(null, Number(el.dataset.equipa)),
  editarPessoa: el => abrirPessoa(Number(el.dataset.id)),
  novoItem: el => abrirItem(el.dataset.tabela, null),
  editarItem: el => abrirItem(el.dataset.tabela, Number(el.dataset.id)),
  filtroEquipa: el => { S.filtroEquipa = el.dataset.id; render(); },
  mes: el => { S.mes = new Date(S.mes.getFullYear(), S.mes.getMonth() + Number(el.dataset.d), 1); render(); },
  mudarUtilizador: () => mostrarQuem(true),
  sair: async () => { if (confirm('Terminar sessão neste telemóvel?')) await sb.auth.signOut(); },
};
const fdsDaDespesa = id => {
  const d = porId('despesas', id), f = d && porId('fins_de_semana', d.fim_de_semana_id);
  return f?.data_sabado || null;
};

document.addEventListener('click', ev => {
  const nav = ev.target.closest('.nav button');
  if (nav) { S.vista = nav.dataset.vista; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-acao]');
  if (el && ACOES[el.dataset.acao]) { ev.preventDefault(); ACOES[el.dataset.acao](el); }
});
document.addEventListener('change', ev => {
  const f = ev.target.dataset?.filtro;
  if (f) { S[f] = ev.target.value; render(); }
});

/* =========================================================
   Entrada com o código da comissão
   ========================================================= */
$('#form-login').addEventListener('submit', async ev => {
  ev.preventDefault();
  const erro = $('#login-erro'), btn = ev.target.querySelector('button');
  erro.hidden = true; btn.disabled = true; btn.textContent = 'A entrar…';
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL_COMISSAO, password: $('#codigo').value });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { erro.textContent = 'Código errado. Tenta outra vez.'; erro.hidden = false; }
});

function mostrarQuem(mudar = false) {
  const u = utilizadorAtual();
  const pessoas = [...D.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  $('#quem-lista').innerHTML = opt('', '— Escolhe o teu nome —', u?.pessoa_id ?? '')
    + pessoas.map(p => opt(p.id, p.nome + (equipa(p.equipa_id) ? ' (' + equipa(p.equipa_id).nome + ')' : ''), u?.pessoa_id ?? '')).join('')
    + opt('outro', 'O meu nome não está na lista', '');
  $('#quem-nome').value = '';
  $('#quem-outro').hidden = true;
  $('#quem-cancelar').hidden = !mudar;
  $('#login').hidden = true; $('#app').hidden = true; $('#quem').hidden = false;
}
$('#quem-lista').addEventListener('change', ev => {
  $('#quem-outro').hidden = ev.target.value !== 'outro';
  if (ev.target.value === 'outro') $('#quem-nome').focus();
});
$('#quem-cancelar').addEventListener('click', () => { $('#quem').hidden = true; $('#app').hidden = false; });
$('#form-quem').addEventListener('submit', async ev => {
  ev.preventDefault();
  const escolha = $('#quem-lista').value;
  const pessoa = escolha && escolha !== 'outro' ? porId('pessoas', escolha) : null;
  const nome = pessoa ? pessoa.nome : $('#quem-nome').value.trim();
  if (!nome) return toast('Escolhe ou escreve o teu nome.', true);
  const btn = ev.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const atual = utilizadorAtual();
    const valores = { nome, pessoa_id: pessoa?.id ?? null, aparelho: tipoAparelho(), ultimo_acesso: new Date().toISOString() };
    if (atual) {
      const { error } = await sb.from('utilizadores').update(valores).eq('id', atual.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('utilizadores').insert({ ...valores, dispositivo: dispositivoId() });
      if (error) throw error;
    }
    await carregar();
    await registarAtividade(atual ? `passou a usar ${tipoAparelho() === 'Computador' ? 'este computador' : 'este ' + tipoAparelho()}` : `registou-se (${tipoAparelho()})`, 'utilizadores', utilizadorAtual()?.id, null);
    await carregar();
    $('#quem').hidden = true; $('#app').hidden = false;
    render();
    toast(`Olá, ${nome.split(' ')[0]}!`);
  } catch (e) {
    console.error(e); toast(erroLegivel(e), true);
  } finally { btn.disabled = false; }
});

async function mostrar(sessao) {
  $('#carregar').hidden = false;
  if (!sessao) {
    $('#app').hidden = true; $('#quem').hidden = true; $('#login').hidden = false; $('#codigo').value = '';
    fecharSheet();
  } else {
    try {
      await carregar();
      const u = utilizadorAtual();
      if (!u) mostrarQuem();
      else {
        $('#login').hidden = true; $('#quem').hidden = true; $('#app').hidden = false;
        render();
        sb.from('utilizadores').update({ ultimo_acesso: new Date().toISOString(), aparelho: tipoAparelho() })
          .eq('id', u.id).then(() => {}, () => {});
      }
    } catch (e) {
      console.error(e);
      toast(erroLegivel(e), true);
    }
  }
  $('#carregar').hidden = true;
}

let ultimoUser;
sb.auth.onAuthStateChange((evento, sessao) => {
  const u = sessao?.user?.id ?? null;
  if (evento === 'INITIAL_SESSION' || u !== ultimoUser) {
    ultimoUser = u;
    setTimeout(() => mostrar(sessao), 0); // fora do callback, como recomenda o Supabase
  }
});

/* =========================================================
   Atualização automática dos dados
   (ao voltar à app, a cada 30 s com a app aberta e no botão ↻)
   ========================================================= */
let aAtualizar = false;
async function atualizar(avisar = false) {
  if ($('#app').hidden || aAtualizar) return;
  aAtualizar = true;
  $('#btn-atualizar')?.classList.add('a-girar');
  try {
    await carregar();
    if ($('#sheet-wrap').hidden) render(); // não mexe num formulário aberto
    if (avisar) toast('Dados atualizados');
  } catch (e) {
    console.error(e);
    if (avisar) toast(erroLegivel(e), true);
  } finally {
    aAtualizar = false;
    $('#btn-atualizar')?.classList.remove('a-girar');
  }
}
ACOES.atualizar = () => atualizar(true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') atualizar(); });
window.addEventListener('pageshow', () => atualizar());
setInterval(() => { if (document.visibilityState === 'visible') atualizar(); }, 30000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
