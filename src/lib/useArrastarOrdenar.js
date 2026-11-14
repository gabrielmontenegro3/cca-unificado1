import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const CLASSE_FANTASMA = 'arr-fantasma';

/** Só um arraste por vez na página inteira. */
let arrasteAtivo = null;

/** Espera a animação, mas nunca trava (aba em segundo plano pausa as animações). */
function aguardar(animacao, limite) {
  return Promise.race([
    animacao.finished.catch(() => {}),
    new Promise((resolve) => { setTimeout(resolve, limite); }),
  ]);
}

/**
 * Copia o visual calculado do item para a cópia flutuante. Assim ela fica igual ao
 * original mesmo fora da lista (em telas onde o estilo depende do elemento pai).
 */
function copiarVisual(origem, destino) {
  const estilo = getComputedStyle(origem);
  for (let i = 0; i < estilo.length; i += 1) {
    const prop = estilo[i];
    destino.style.setProperty(prop, estilo.getPropertyValue(prop));
  }
  const filhosOrigem = origem.children;
  const filhosDestino = destino.children;
  for (let i = 0; i < filhosOrigem.length && i < filhosDestino.length; i += 1) {
    copiarVisual(filhosOrigem[i], filhosDestino[i]);
  }
}

/** Lista sem itens repetidos (proteção contra duplicar um registro na tela). */
function semRepetidos(lista, getId) {
  const vistos = new Set();
  return lista.filter((item) => {
    const id = getId(item);
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
}

/**
 * Arrastar e soltar para mudar a ordem de uma lista, com animação:
 * o item levanta (cópia flutuante que inclina com o movimento), os outros deslizam
 * para abrir espaço e, ao soltar, ele pousa no lugar novo.
 *
 * Proteções contra o item "duplicar": só um arraste por vez, cópias antigas são
 * removidas, o arraste termina se a janela perder o foco, Esc desfaz, e a lista
 * nunca fica com o mesmo item duas vezes.
 *
 * @param itens        lista atual (estado do componente)
 * @param setItens     função que troca a lista
 * @param getId        id de cada item
 * @param ativo        liga/desliga o arraste (ex.: só em "Editar tela")
 * @param onSoltar     (listaNova, idsAntes) => salva a ordem; chamado só se mudou
 * @param ignorar      seletor dos elementos que não iniciam arraste (botões etc.)
 */
export function useArrastarOrdenar({
  itens,
  setItens,
  getId,
  ativo,
  onSoltar,
  ignorar = 'button, a, input, textarea, select, label',
}) {
  const [arrastandoId, setArrastandoId] = useState('');
  const itensRef = useRef(itens);
  itensRef.current = itens;
  const elementos = useRef(new Map());
  const antes = useRef(null);
  const estadoRef = useRef(null);
  const suprimirClique = useRef(false);

  // FLIP: quem mudou de lugar desliza da posição antiga até a nova.
  useLayoutEffect(() => {
    const mapa = antes.current;
    if (!mapa) return;
    antes.current = null;
    elementos.current.forEach((el, id) => {
      const anterior = mapa.get(id);
      if (!anterior || !el?.isConnected) return;
      const atual = el.getBoundingClientRect();
      const dx = anterior.left - atual.left;
      const dy = anterior.top - atual.top;
      if (!dx && !dy) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 260, easing: EASE },
      );
    });
  }, [itens]);

  // Saiu da tela no meio do arraste: encerra sem deixar sobra.
  useEffect(() => () => estadoRef.current?.encerrar(false), []);

  function guardarPosicoes() {
    const mapa = new Map();
    elementos.current.forEach((el, id) => { if (el?.isConnected) mapa.set(id, el.getBoundingClientRect()); });
    antes.current = mapa;
  }

  function calcularDestino(x, y, idArrastado) {
    const lista = itensRef.current;
    let destino = lista.length;
    for (let i = 0; i < lista.length; i += 1) {
      const id = getId(lista[i]);
      if (id === idArrastado) continue;
      const el = elementos.current.get(id);
      if (!el?.isConnected) continue;
      const r = el.getBoundingClientRect();
      const passou = y > r.bottom || (y >= r.top && y <= r.bottom && x > r.left + r.width / 2);
      if (!passou) return i;
      destino = i + 1;
    }
    return destino;
  }

  function mover(idArrastado, destino) {
    const lista = itensRef.current;
    const de = lista.findIndex((item) => getId(item) === idArrastado);
    if (de < 0) return;
    let para = destino > de ? destino - 1 : destino;
    para = Math.max(0, Math.min(para, lista.length - 1));
    if (para === de) return;
    guardarPosicoes();
    const nova = lista.slice();
    const [item] = nova.splice(de, 1);
    nova.splice(para, 0, item);
    const limpa = semRepetidos(nova, getId);
    itensRef.current = limpa;
    setItens(limpa);
  }

  function iniciar(event, id) {
    if (!ativo || event.button !== 0 || !event.isPrimary) return;
    if (ignorar && event.target.closest(ignorar) && event.target.closest(ignorar) !== event.currentTarget) return;
    // Um arraste anterior que não terminou é fechado antes (e as cópias antigas somem).
    arrasteAtivo?.encerrar(true, { imediato: true });
    document.querySelectorAll(`.${CLASSE_FANTASMA}`).forEach((el) => el.remove());

    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const inicio = { x: event.clientX, y: event.clientY };
    const estado = {
      id,
      pointerId: event.pointerId,
      offset: { x: inicio.x - rect.left, y: inicio.y - rect.top },
      ghost: null,
      alvo: null,
      ultimoX: inicio.x,
      inclinacao: 0,
      frame: 0,
      finalizado: false,
      idsAntes: itensRef.current.map(getId),
    };

    function desenhar() {
      estado.frame = 0;
      const { ghost, alvo } = estado;
      if (!ghost || !alvo) return;
      const alvoInclinacao = Math.max(-8, Math.min(8, (alvo.x - estado.ultimoX) * 0.6));
      estado.inclinacao += (alvoInclinacao - estado.inclinacao) * 0.25;
      estado.ultimoX = alvo.x;
      ghost.style.transform = `translate(${alvo.x - estado.offset.x}px, ${alvo.y - estado.offset.y}px) rotate(${estado.inclinacao.toFixed(2)}deg) scale(1.04)`;
      if (Math.abs(estado.inclinacao) > 0.05) estado.frame = requestAnimationFrame(desenhar);
    }

    function comecar() {
      const ghost = card.cloneNode(true);
      copiarVisual(card, ghost);
      // Posição e movimento ficam por conta da cópia flutuante.
      for (const prop of ['position', 'left', 'top', 'right', 'bottom', 'margin', 'z-index', 'transform', 'transition', 'animation', 'opacity', 'visibility', 'translate', 'rotate', 'scale']) {
        ghost.style.removeProperty(prop);
      }
      ghost.classList.add(CLASSE_FANTASMA);
      ghost.removeAttribute('data-arr-id');
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      document.body.appendChild(ghost);
      ghost.animate(
        [
          { transform: `translate(${rect.left}px, ${rect.top}px) scale(1)`, boxShadow: '0 4px 10px rgba(15,23,32,0.12)' },
          { transform: `translate(${rect.left}px, ${rect.top}px) scale(1.04)`, boxShadow: '0 28px 56px rgba(15,23,32,0.32)' },
        ],
        { duration: 180, easing: EASE },
      );
      estado.ghost = ghost;
      // Só agora (arraste de verdade) o ponteiro fica preso ao item; um clique simples segue normal.
      try { card.setPointerCapture?.(estado.pointerId); } catch { /* segue ouvindo pela janela */ }
      document.body.classList.add('docs-dragging');
      setArrastandoId(id);
    }

    function aoMover(e) {
      if (e.pointerId !== estado.pointerId) return;
      if (!estado.ghost) {
        const dx = e.clientX - inicio.x;
        const dy = e.clientY - inicio.y;
        if (dx * dx + dy * dy < 36) return;
        comecar();
      }
      estado.alvo = { x: e.clientX, y: e.clientY };
      if (!estado.frame) estado.frame = requestAnimationFrame(desenhar);
      mover(estado.id, calcularDestino(e.clientX, e.clientY, estado.id));
    }

    function aoSoltar(e) {
      if (e.pointerId !== estado.pointerId) return;
      encerrar(true);
    }

    function aoTecla(e) {
      if (e.key !== 'Escape' || !estado.ghost) return;
      // Esc: volta para a ordem de antes, sem salvar.
      const porId = new Map(itensRef.current.map((item) => [getId(item), item]));
      const original = estado.idsAntes.map((x) => porId.get(x)).filter(Boolean);
      guardarPosicoes();
      itensRef.current = original;
      setItens(original);
      encerrar(false);
    }

    function aoPerderFoco() { encerrar(true); }
    function aoMudarVisibilidade() { if (document.hidden) encerrar(true); }

    function remover() {
      window.removeEventListener('pointermove', aoMover);
      window.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('pointercancel', aoSoltar);
      window.removeEventListener('keydown', aoTecla);
      window.removeEventListener('blur', aoPerderFoco);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    }

    async function encerrar(salvar, { imediato = false } = {}) {
      if (estado.finalizado) return;
      estado.finalizado = true;
      remover();
      cancelAnimationFrame(estado.frame);
      if (arrasteAtivo === estado) arrasteAtivo = null;
      if (estadoRef.current === estado) estadoRef.current = null;
      const { ghost } = estado;
      if (!ghost) return;
      suprimirClique.current = true;
      setTimeout(() => { suprimirClique.current = false; }, 0);
      // A ordem é decidida e salva no instante em que solta; a animação de pouso é só visual.
      const lista = semRepetidos(itensRef.current, getId);
      const mudou = lista.map(getId).join('|') !== estado.idsAntes.join('|');
      if (salvar && mudou) onSoltar?.(lista, estado.idsAntes);
      const destinoEl = elementos.current.get(estado.id);
      const r = !imediato && destinoEl?.isConnected ? destinoEl.getBoundingClientRect() : null;
      if (r) {
        await aguardar(ghost.animate(
          [
            { transform: ghost.style.transform, boxShadow: '0 28px 56px rgba(15,23,32,0.32)' },
            { transform: `translate(${r.left}px, ${r.top}px) rotate(0deg) scale(1)`, boxShadow: '0 4px 10px rgba(15,23,32,0.12)' },
          ],
          { duration: 220, easing: EASE, fill: 'forwards' },
        ), 280);
      }
      // A cópia some no mesmo momento em que o item real reaparece: nunca os dois juntos.
      ghost.remove();
      if (!document.querySelector(`.${CLASSE_FANTASMA}`)) document.body.classList.remove('docs-dragging');
      setArrastandoId((atual) => (atual === estado.id ? '' : atual));
      if (!imediato) {
        destinoEl?.animate?.(
          [{ transform: 'scale(0.97)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }],
          { duration: 260, easing: 'ease-out' },
        );
      }
    }

    estado.encerrar = encerrar;
    arrasteAtivo = estado;
    estadoRef.current = estado;
    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoSoltar);
    window.addEventListener('keydown', aoTecla);
    window.addEventListener('blur', aoPerderFoco);
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
  }

  /** Propriedades para colocar no elemento de cada item da lista. */
  function propsItem(item) {
    const id = getId(item);
    return {
      'data-arr-id': id,
      ref: (el) => { if (el) elementos.current.set(id, el); else elementos.current.delete(id); },
      onPointerDown: (e) => iniciar(e, id),
      // Impede o arraste nativo do navegador (que cria uma "cópia" da imagem).
      onDragStart: (e) => { if (ativo) e.preventDefault(); },
      // Depois de arrastar, o clique de soltar não abre o registro.
      onClickCapture: (e) => {
        if (!suprimirClique.current) return;
        suprimirClique.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }

  /** Chame antes de mudar a lista por outro motivo (ex.: excluir) para os itens deslizarem. */
  return { arrastandoId, propsItem, prepararAnimacao: guardarPosicoes };
}
