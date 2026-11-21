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
  'pessoas', 'fins_de_semana', 'eventos', 'despesas'];
const D = Object.fromEntries(TABELAS.map(t => [t, []]));
const S = {
  vista: 'inicio',
  mes: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  filtroEquipa: '',     // calendário
  despFds: '', despCat: '', // aba Despesas
  dashCat: '',          // dashboard
};
const porId = (t, id) => D[t].find(x => x.id === Number(id));
const equipa = id => porId('equipas', id);
const fdsPorSabado = sab => D.fins_de_semana.find(f => f.data_sabado === sab);

async function carregar() {
  const res = await Promise.all(TABELAS.map(t => sb.from(t).select('*').order('id')));
  res.forEach((r, i) => { if (r.error) throw r.error; D[TABELAS[i]] = r.data; });
}

async function guardar(tabela, valores, id) {
  const q = id ? sb.from(tabela).update(valores).eq('id', id) : sb.from(tabela).insert(valores);
  const { error } = await q;
  if (error) throw error;
}
async function apagar(tabela, id) {
  const { error } = await sb.from(tabela).delete().eq('id', id);
  if (error) throw error;
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

const TITULOS = { inicio: 'Início', calendario: 'Calendário', despesas: 'Despesas', equipas: 'Equipas', listas: 'Listas' };

function render() {
  $('#titulo').textContent = TITULOS[S.vista];
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('ativo', b.dataset.vista === S.vista));
  const v = { inicio: vInicio, calendario: vCalendario, despesas: vDespesas, equipas: vEquipas, listas: vListas }[S.vista];
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

  // despesas por categoria
  const porCat = D.categorias_despesa.map(c => ({
    c, total: soma(D.despesas.filter(d => d.categoria_id === c.id), 'preco'),
  })).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...porCat.map(x => x.total));
  const totalSel = S.dashCat ? soma(D.despesas.filter(d => d.categoria_id === Number(S.dashCat)), 'preco') : totalDesp;

  const eventos = [...D.eventos].sort((a, b) => b.data.localeCompare(a.data));

  return `
  <div class="cartao toque" data-acao="abrirFds" data-sab="${sab}">
    <div class="kpi-rotulo">${sab <= hoje || iso(addDias(parse(sab), 1)) === hoje ? 'Este fim de semana' : 'Próximo fim de semana'} · ${fmtFds(sab)}</div>
    <div style="margin-top:8px;font-size:18px">${fds ? chipEquipa(fds.equipa_id) : '<span class="kpi-rotulo">Ainda não definido. Toca para escolher a equipa.</span>'}</div>
  </div>
  <div class="grelha">
    <div class="cartao"><div class="kpi-rotulo">Fins de semana realizados</div><div class="kpi-valor">${realizados}</div></div>
    <div class="cartao"><div class="kpi-rotulo">Total de despesas</div><div class="kpi-valor">${eur(totalDesp)}</div></div>
    <div class="cartao largo"><div class="kpi-rotulo">Lucro total (soma dos lucros finais de domingo)</div><div class="kpi-valor pos">${eur(lucro)}</div></div>
  </div>

  <div class="cartao">
    <h3>Despesas por categoria</h3>
    <select data-filtro="dashCat">${opt('', 'Todas as categorias', S.dashCat)}${D.categorias_despesa.map(c => opt(c.id, c.nome, S.dashCat)).join('')}</select>
    <div class="total-linha"><span>${S.dashCat ? esc(porId('categorias_despesa', S.dashCat)?.nome) : 'Todas'}</span><b>${eur(totalSel)}</b></div>
    ${porCat.length ? porCat.map(x => `
      <div class="barra-linha${String(x.c.id) === String(S.dashCat) ? ' sel' : ''}">
        <span>${esc(x.c.nome)}</span><div class="barra"><i style="width:${(x.total / max * 100).toFixed(1)}%"></i></div><b>${eur(x.total)}</b>
      </div>`).join('') : '<div class="vazio">Ainda não há despesas.</div>'}
  </div>

  <div class="cartao">
    <h3>Eventos</h3>
    <p class="dica">O lucro dos eventos é só uma nota; já está incluído no lucro final de domingo.</p>
    ${eventos.length ? `<ul class="lista">${eventos.map(e => `
      <li class="toque" data-acao="editarEvento" data-id="${e.id}">
        <div class="princ"><b>${esc(e.nome)}</b><div class="sub">${fmtCurta(e.data)} · ${e.num_pessoas ?? '—'} pessoas</div><div class="sub">${chipEquipa(e.equipa_id, e.todas_equipas)}</div></div>
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
  <p class="dica" style="margin-top:12px">Toca num sábado ou domingo para definir a equipa, a ementa, as despesas e o lucro. Toca noutro dia para criar um evento.</p>
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
    <div class="acoes"><button class="btn primario" type="submit">${fds ? 'Guardar' : 'Criar fim de semana'}</button></div>
  </form>
  ${fds ? `
    <div class="grupo-titulo">Despesas deste fim de semana</div>
    <div class="total-linha"><span>Total</span><b>${eur(soma(desp, 'preco'))}</b></div>
    ${desp.length ? `<ul class="lista">${desp.map(linhaDespesa).join('')}</ul>` : '<div class="vazio">Sem despesas.</div>'}
    <div class="acoes"><button class="btn" data-acao="novaDespesa" data-fds="${fds.id}" data-volta="${sab}">+ Despesa</button></div>
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
      <div class="sub">${d.data_encomenda ? fmtCurta(d.data_encomenda) : 'Sem data'} · ${esc(p?.nome || 'Sem responsável')}</div></div>
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

function abrirDespesa(id, fdsId, voltaSab) {
  const d = id ? porId('despesas', id) : null;
  if (!D.fins_de_semana.length) return toast('Primeiro cria um fim de semana no calendário.', true);
  if (!D.categorias_despesa.length) return toast('Primeiro cria categorias de despesa em Listas.', true);
  const catInicial = d?.categoria_id ?? D.categorias_despesa[0].id;
  const fdsInicial = d?.fim_de_semana_id ?? fdsId ?? fdsOrdenados()[0].id;
  const voltar = voltaSab ? () => abrirFds(voltaSab) : null;
  // numa despesa nova, sugere a primeira pessoa responsável pela categoria
  const sugerido = cat => {
    const r = porId('categorias_despesa', cat)?.responsabilidade_id;
    return r ? [...D.pessoas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).find(p => p.responsabilidade_id === r)?.id ?? '' : '';
  };

  const html = `
  <form id="f-desp">
    <div class="campo"><label>Categoria</label><select name="categoria_id" required>${optsLista('categorias_despesa', catInicial)}</select></div>
    <div class="campo"><label>Responsável</label><select name="pessoa_id">${optsResponsavel(catInicial, d ? d.pessoa_id : sugerido(catInicial))}</select></div>
    <div class="campo"><label>Dia da encomenda</label><input name="data_encomenda" type="date" value="${d?.data_encomenda ?? hojeIso()}"></div>
    <div class="campo"><label>Preço (€)</label><input name="preco" type="text" inputmode="decimal" required placeholder="0,00" value="${d?.preco ?? ''}"></div>
    <div class="campo"><label>Descrição (opcional)</label><input name="descricao" type="text" placeholder="Ex.: 40 frangos" value="${esc(d?.descricao)}"></div>
    <div class="campo"><label>Fim de semana</label><select name="fim_de_semana_id" required>${optsFds(fdsInicial)}</select></div>
    <div class="acoes">
      ${d ? '<button class="btn perigo" type="button" id="apagar-desp">Apagar</button>' : ''}
      <button class="btn primario" type="submit">Guardar</button>
    </div>
  </form>`;

  abrirSheet(d ? 'Editar despesa' : 'Nova despesa', html, el => {
    const form = $('#f-desp', el);
    form.categoria_id.onchange = () => {
      const cat = Number(form.categoria_id.value);
      form.pessoa_id.innerHTML = optsResponsavel(cat, form.pessoa_id.value || sugerido(cat));
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
        fim_de_semana_id: Number(f.get('fim_de_semana_id')),
      };
      acao(() => guardar('despesas', valores, d?.id), 'Despesa guardada', voltar);
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
    : '<div class="vazio">Sem despesas para estes filtros.</div>'}
  <button class="fab" data-acao="novaDespesa" data-fds="${esc(S.despFds)}">+ Despesa</button>`;
}

/* =========================================================
   Vista: Equipas (equipas + pessoas)
   ========================================================= */
function linhaPessoa(p) {
  const fn = porId('funcoes', p.funcao_id), r = porId('responsabilidades', p.responsabilidade_id);
  return `<li class="toque" data-acao="editarPessoa" data-id="${p.id}">
    <div class="princ"><b>${esc(p.nome)}</b><div class="sub">${esc(fn?.nome || 'Sem função')} · Resp.: ${esc(r?.nome || 'nenhuma')}</div></div>
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
  categorias_despesa: { titulo: 'Categorias de despesa', exemplo: 'Ex.: Frango' },
};

function vListas() {
  return Object.entries(LISTAS).map(([t, cfg]) => `
    <div class="cartao">
      <h3>${cfg.titulo}</h3>
      ${D[t].length ? `<ul class="lista">${[...D[t]].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map(x => `
        <li class="toque" data-acao="editarItem" data-tabela="${t}" data-id="${x.id}">
          <div class="princ">${esc(x.nome)}${t === 'categorias_despesa' && x.responsabilidade_id
            ? `<div class="sub">Responsabilidade: ${esc(porId('responsabilidades', x.responsabilidade_id)?.nome)}</div>` : ''}</div>
          <span class="sub">›</span></li>`).join('')}</ul>` : '<div class="vazio">Lista vazia.</div>'}
      <div class="acoes"><button class="btn bloco peq" data-acao="novoItem" data-tabela="${t}">+ Adicionar</button></div>
    </div>`).join('') + `
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
      <p class="dica">Nas despesas desta categoria, as pessoas com esta responsabilidade aparecem primeiro.</p>` : ''}
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
      if (tabela === 'categorias_despesa') v.responsabilidade_id = idOuNull(form.responsabilidade_id.value);
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
  novaEquipa: () => abrirEquipa(null),
  editarEquipa: el => abrirEquipa(Number(el.dataset.id)),
  novaPessoa: el => abrirPessoa(null, Number(el.dataset.equipa)),
  editarPessoa: el => abrirPessoa(Number(el.dataset.id)),
  novoItem: el => abrirItem(el.dataset.tabela, null),
  editarItem: el => abrirItem(el.dataset.tabela, Number(el.dataset.id)),
  filtroEquipa: el => { S.filtroEquipa = el.dataset.id; render(); },
  mes: el => { S.mes = new Date(S.mes.getFullYear(), S.mes.getMonth() + Number(el.dataset.d), 1); render(); },
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

async function mostrar(sessao) {
  $('#carregar').hidden = false;
  if (!sessao) {
    $('#app').hidden = true; $('#login').hidden = false; $('#codigo').value = '';
    fecharSheet();
  } else {
    try {
      await carregar();
      $('#login').hidden = true; $('#app').hidden = false;
      render();
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
