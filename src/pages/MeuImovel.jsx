import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../components/ui';
import { Icon } from '../components/icons';

const SECOES = [
  {
    id: 'recebimento',
    titulo: 'Recebimento do Imóvel',
    blocos: [
      {
        tipo: 'p',
        texto: 'A unidade é entregue ao comprador que estiver com as obrigações financeiras em dia, conforme estabelecido em contrato específico, e mediante vistoria do imóvel, em conjunto com representante da construtora.',
      },
      {
        tipo: 'p',
        texto: 'Na Vistoria, verifica-se o cumprimento das especificações e a existência de vícios de construção aparentes. Caso sejam verificados defeitos, a construtora irá realizar as devidas reparações para posteriormente ser feita a entrega do imóvel.',
      },
      {
        tipo: 'p',
        texto: 'O Termo de Entrega de Chaves é assinado no ato do recebimento de sua unidade.',
      },
      {
        tipo: 'dica',
        texto: 'Se quiser saber mais sobre o que são “vícios de construção aparentes”, clique na lupa acima e procure pelo post “Vícios Ocultos e Aparentes”.',
        to: '/visao-geral',
        label: 'Buscar na Visão geral',
      },
    ],
  },
  {
    id: 'procedimentos',
    titulo: 'Procedimentos Iniciais',
    blocos: [
      {
        tipo: 'p',
        texto: 'Recebendo as chaves do imóvel, o usuário deverá providenciar, junto às concessionárias, as ligações individuais de alguns serviços indispensáveis ao funcionamento de seu conjunto, sendo necessário informar o endereço completo do imóvel, o nome do edifício, telefone para contato, nome completo do usuário, CPF e RG.',
      },
      {
        tipo: 'dica',
        texto: 'Para identificar sua concessionária de energia e obter orientações sobre como efetuar a ligação, clique na lupa acima e digite “ligação de energia”. Você também encontra esse post em Visão geral, na seção PRIMEIROS PASSOS.',
        to: '/visao-geral',
        label: 'Ver primeiros passos',
      },
      {
        tipo: 'p',
        texto: 'Além disso, caso haja alguma dúvida em relação à utilização das instalações elétricas, hidráulicas, de telefone, de interfone, dimensionamento de peças, especificações de equipamentos, funcionamentos diversos, além dos limites de cargas estruturais, o usuário deverá consultar os respectivos projetos executivos.',
      },
      {
        tipo: 'p',
        texto: 'Ressaltamos que, na seção de Documentos deste Manual Interativo do Proprietário, constam as principais plantas dos apartamentos, porém, ao síndico serão disponibilizados os principais projetos executivos, de forma completa, os quais deverão estar à disposição para eventuais consultas.',
      },
      {
        tipo: 'p',
        texto: 'Se mesmo após esta consulta persistirem as dúvidas, orientamos entrar em contato com a Construtora/Incorporadora, para que sejam devidamente suprimidas.',
      },
    ],
  },
];

function textoSecao(secao) {
  return secao.blocos.map((b) => b.texto).join(' ');
}

function SecaoGuia({ secao, aberta, onToggle }) {
  return (
    <article className={`meu-imovel-secao${aberta ? ' is-open' : ''}`}>
      <button type="button" className="meu-imovel-secao-toggle" onClick={onToggle} aria-expanded={aberta}>
        <h2>{secao.titulo}</h2>
        <span className="meu-imovel-secao-action">{aberta ? 'Ver menos' : 'Ver mais'}</span>
      </button>
      {aberta ? (
        <div className="meu-imovel-secao-body">
          {secao.blocos.map((bloco) => {
            if (bloco.tipo === 'dica') {
              return (
                <aside key={bloco.texto.slice(0, 40)} className="meu-imovel-dica" role="note">
                  <span className="meu-imovel-dica-icon" aria-hidden="true">
                    <Icon name="alert" size={18} />
                  </span>
                  <div className="meu-imovel-dica-copy">
                    <p>{bloco.texto}</p>
                    {bloco.to ? (
                      <Link className="meu-imovel-dica-link" to={bloco.to}>
                        <Icon name="search" size={16} />
                        <span>{bloco.label}</span>
                      </Link>
                    ) : null}
                  </div>
                </aside>
              );
            }
            return <p key={bloco.texto.slice(0, 48)}>{bloco.texto}</p>;
          })}
        </div>
      ) : null}
    </article>
  );
}

export function MeuImovelPage() {
  const [abertas, setAbertas] = useState(() => Object.fromEntries(SECOES.map((s) => [s.id, true])));
  const [q, setQ] = useState('');

  const query = q.trim().toLowerCase();
  const secoes = query
    ? SECOES.filter((secao) => `${secao.titulo} ${textoSecao(secao)}`.toLowerCase().includes(query))
    : SECOES;

  function toggle(id) {
    setAbertas((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <Page
      title="Meu imóvel"
      lead="Orientações sobre o recebimento da unidade e os primeiros procedimentos após a entrega das chaves."
      className="page-meu-imovel"
      search={{
        value: q,
        onChange: setQ,
        placeholder: 'Buscar no Meu imóvel…',
      }}
    >
      <div className="meu-imovel-stack">
        {!secoes.length ? (
          <p className="meu-imovel-empty">Nenhum resultado para “{q.trim()}”.</p>
        ) : (
          secoes.map((secao) => (
            <SecaoGuia
              key={secao.id}
              secao={secao}
              aberta={abertas[secao.id] !== false}
              onToggle={() => toggle(secao.id)}
            />
          ))
        )}
      </div>
    </Page>
  );
}
