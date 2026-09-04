import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { chamadoNumero, formatDateTime } from './format';
import { tipoLabelEvento, tituloRastreabilidade } from './chamadoRastreabilidade';
import { STATUS_LABEL } from './permissions';
import { arquivoEhImagem, publicOrSignedUrl } from './api';

function esc(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugArquivo(value) {
  return String(value || 'chamado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'chamado';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

async function arquivoComDataUrl(arquivo) {
  const isImage = arquivoEhImagem(arquivo);
  if (!arquivo?.storage_path || !isImage) {
    return { ...arquivo, isImage, dataUrl: null };
  }
  try {
    const { data } = await publicOrSignedUrl(arquivo.storage_path);
    const url = data?.signedUrl;
    if (!url) return { ...arquivo, isImage, dataUrl: null };
    const res = await fetch(url);
    if (!res.ok) return { ...arquivo, isImage, dataUrl: null };
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    return { ...arquivo, isImage, dataUrl };
  } catch {
    return { ...arquivo, isImage, dataUrl: null };
  }
}

async function embedItem(item) {
  const arquivos = await Promise.all((item.arquivos || []).map(arquivoComDataUrl));
  const children = item.children?.length
    ? await Promise.all(item.children.map(embedItem))
    : [];
  return { ...item, arquivos, children };
}

function tipoLabel(item) {
  return tipoLabelEvento(item);
}

function galleryHtml(arquivos) {
  if (!arquivos?.length) return '';
  const figs = arquivos.map((arquivo) => {
    if (arquivo.dataUrl) {
      const cap = arquivo.descricao_foto
        ? `<figcaption>${esc(arquivo.descricao_foto)}</figcaption>`
        : '';
      return `<figure class="g-item"><img src="${arquivo.dataUrl}" alt="" />${cap}</figure>`;
    }
    return `<div class="g-file">${esc(arquivo.nome_original || 'Arquivo')}</div>`;
  }).join('');
  return `<div class="gallery">${figs}</div>`;
}

function cardHtml(item, inspecoes) {
  const titulo = esc(item.titulo || tituloRastreabilidade(item));
  const quem = item.registrado?.nome || item.usuarios?.nome;
  const parent = item.parent_id
    ? inspecoes.find((i) => i.id === item.parent_id)
    : null;
  const children = (item.children || []).map((child) => cardHtml(child, inspecoes)).join('');
  return `
    <article class="card tipo-${esc(item.tipo || item.kind || '')}">
      <header class="card-head">
        <span class="badge">${esc(tipoLabel(item))}</span>
        <time>${esc(formatDateTime(item.when || item.created_at))}</time>
      </header>
      <h3>${titulo}</h3>
      ${quem ? `<p class="meta">Por ${esc(quem)}</p>` : ''}
      ${parent ? `<p class="meta">Vinculado à ${esc(String(parent.numero_inspecao))}ª inspeção</p>` : ''}
      ${item.observacao ? `<p class="text">${esc(item.observacao).replace(/\n/g, '<br>')}</p>` : ''}
      ${item.descricao ? `<p class="text">${esc(item.descricao).replace(/\n/g, '<br>')}</p>` : ''}
      ${item.atendentes?.length ? `<p class="meta">Atendentes: ${esc(item.atendentes.map((a) => a.nome).join(', '))}</p>` : ''}
      ${galleryHtml(item.arquivos)}
      ${children ? `<div class="children">${children}</div>` : ''}
    </article>
  `;
}

function reportCss() {
  return `
    * { box-sizing: border-box; }
    .sheet {
      width: 794px;
      padding: 28px 32px 36px;
      background: #f3eee6;
      color: #1d1915;
      font-family: "DM Sans", "Segoe UI", system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #2c5c4f;
      margin: 0 0 6px;
    }
    h1 {
      font-family: Fraunces, Palatino, Georgia, serif;
      font-size: 30px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 4px;
    }
    .lead { margin: 0 0 18px; color: #6d6458; font-size: 13px; }
    .summary {
      background: #fffcf7;
      border: 1px solid #e4d8c8;
      border-radius: 16px;
      padding: 16px 18px;
      margin-bottom: 22px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 14px 18px;
    }
    .label {
      display: block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #6d6458;
      margin-bottom: 4px;
    }
    .summary strong { font-size: 14px; }
    .problem { margin: 14px 0 0; font-size: 15px; font-weight: 650; line-height: 1.4; }
    .timeline { list-style: none; margin: 0; padding: 0; }
    .item {
      position: relative;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 0 16px;
      padding-bottom: 18px;
    }
    .dot {
      width: 14px;
      height: 14px;
      margin: 18px 0 0 7px;
      border-radius: 50%;
      background: #2c5c4f;
      box-shadow: 0 0 0 4px rgba(44, 92, 79, 0.18);
    }
    .line {
      position: absolute;
      left: 13px;
      top: 32px;
      bottom: 0;
      width: 2px;
      background: #d7c9b6;
    }
    .card {
      background: #fffcf7;
      border: 1px solid #e4d8c8;
      border-radius: 16px;
      padding: 14px 16px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #2c5c4f;
      background: rgba(44, 92, 79, 0.12);
      padding: 4px 8px;
      border-radius: 999px;
    }
    .tipo-abertura .badge { color: #2c6b9e; background: rgba(44, 107, 158, 0.12); }
    .tipo-status .badge { color: #6b5b8a; background: rgba(107, 91, 138, 0.12); }
    .tipo-repasse_construtora .badge,
    .tipo-repasse_administracao .badge { color: #b45309; background: rgba(180, 83, 9, 0.12); }
    time { font-size: 12px; color: #6d6458; }
    h3 { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.3; }
    .meta { margin: 6px 0 0; font-size: 12px; color: #6d6458; }
    .text { margin: 10px 0 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .gallery {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .g-item { margin: 0; }
    .g-item img {
      width: 100%;
      height: 110px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid #e4d8c8;
      display: block;
    }
    .g-item figcaption { font-size: 11px; color: #6d6458; margin-top: 6px; line-height: 1.35; }
    .g-file { font-size: 12px; color: #2c5c4f; padding-top: 8px; }
    .children {
      margin-top: 12px;
      padding-left: 12px;
      border-left: 2px solid #cfe0d9;
      display: grid;
      gap: 10px;
    }
    .children .card { background: #f7f3ec; }
    .foot { margin: 8px 0 0; color: #6d6458; font-size: 11px; }
  `;
}

function reportHtml({ chamado, timeline, inspecoes }) {
  const numero = chamadoNumero(chamado?.numero_registro);
  const cards = (timeline || []).map((item, index) => `
    <li class="item">
      <span class="dot"></span>
      ${index < timeline.length - 1 ? '<span class="line"></span>' : ''}
      ${cardHtml(item, inspecoes)}
    </li>
  `).join('');

  return `
    <div class="sheet">
      <style>${reportCss()}</style>
      <p class="brand">CCA · Relatório</p>
      <h1>Rastreabilidade</h1>
      <p class="lead">${esc(numero)} · ${esc(chamado?.titulo || 'Chamado')}</p>
      <section class="summary">
        <div class="grid">
          <div><span class="label">Solicitante</span><strong>${esc(chamado?.usuarios?.nome || '—')}</strong></div>
          <div><span class="label">Unidade</span><strong>${esc(chamado?.unidades?.identificacao || '—')}</strong></div>
          <div><span class="label">Abertura</span><strong>${esc(formatDateTime(chamado?.created_at))}</strong></div>
          <div><span class="label">Status</span><strong>${esc(STATUS_LABEL[chamado?.status] || chamado?.status || '—')}</strong></div>
        </div>
        <p class="problem"><span class="label">Problema</span>${esc(chamado?.titulo || '')}</p>
        ${chamado?.descricao ? `<p class="text">${esc(chamado.descricao).replace(/\n/g, '<br>')}</p>` : ''}
      </section>
      <ol class="timeline">${cards}</ol>
      <p class="foot">Gerado em ${esc(formatDateTime(new Date().toISOString()))}</p>
    </div>
  `;
}

export function waitImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  return Promise.all(imgs.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }));
}

export function downloadPdf(pdf, filename) {
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function canvasToPdf(canvas) {
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const pageHeightPx = Math.max(1, (canvas.width * pageHeight) / pageWidth);
  let y = 0;
  let page = 0;
  while (y < canvas.height) {
    const sliceHeight = Math.min(pageHeightPx, canvas.height - y);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.ceil(sliceHeight);
    const ctx = pageCanvas.getContext('2d');
    ctx.fillStyle = '#f3eee6';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, y, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const img = pageCanvas.toDataURL('image/jpeg', 0.93);
    const sliceMm = (sliceHeight * imgWidth) / canvas.width;
    if (page > 0) pdf.addPage();
    pdf.addImage(img, 'JPEG', 0, 0, imgWidth, sliceMm, undefined, 'FAST');
    y += sliceHeight;
    page += 1;
  }
  return pdf;
}

export async function exportarRelatorioChamado({
  chamado,
  timeline = [],
  inspecoes = [],
}) {
  const embedded = await Promise.all((timeline || []).map(embedItem));
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#f3eee6;z-index:-1;';
  host.innerHTML = reportHtml({
    chamado,
    timeline: embedded,
    inspecoes,
  });
  document.body.appendChild(host);

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await waitImages(host);
    const sheet = host.querySelector('.sheet');
    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f3eee6',
      logging: false,
      windowWidth: 794,
    });
    const numero = slugArquivo(chamadoNumero(chamado?.numero_registro).replace('ID: ', 'ID-'));
    const filename = `rastreabilidade-${numero}.pdf`;
    const pdf = canvasToPdf(canvas);
    downloadPdf(pdf, filename);
  } finally {
    host.remove();
  }
}
