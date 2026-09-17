import { useEffect, useState } from 'react';
import { Field } from './ui';
import { listarCondominiosDaConstrutora } from '../lib/api';

export const ESCOPO_TODOS = { todos: true, ids: [] };

export function validarEscopo({ todos, ids }, temCondos = true) {
  if (todos) return [];
  if (!ids?.length) {
    throw new Error(temCondos
      ? 'Selecione pelo menos um condomínio, ou marque que trabalha em todos.'
      : 'Ainda não há condomínio nesta construtora. Deixe marcado “todos” ou cadastre um condomínio primeiro.');
  }
  return ids;
}

export function FotoPicker({ file, onChange, hint = 'JPG, PNG ou WebP. Aparece no perfil.' }) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!file) {
      setPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <Field label="Foto">
      <div className="foto-picker">
        <span className={`foto-picker-preview${preview ? ' has-file' : ''}`}>
          {preview ? <img src={preview} alt="" /> : null}
        </span>
        <label className="foto-picker-pick">
          {file ? 'Trocar foto' : 'Enviar foto'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            onChange={(e) => onChange(e.target.files?.[0] || null)}
          />
        </label>
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>{hint}</p>
    </Field>
  );
}

export function EscopoCondominios({ construtoraId, todos = true, ids = [], onChange }) {
  const [condos, setCondos] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!construtoraId) {
      setCondos([]);
      return undefined;
    }
    let live = true;
    listarCondominiosDaConstrutora(construtoraId).then((rows) => {
      if (!live) return;
      setCondos(rows || []);
      setLoadError('');
    }).catch((err) => {
      if (!live) return;
      setCondos([]);
      setLoadError(err.message || 'Não foi possível carregar os condomínios.');
    });
    return () => { live = false; };
  }, [construtoraId]);

  function setTodos(next) {
    onChange({ todos: next, ids: next ? [] : ids });
  }

  function toggleOne(id, checked) {
    const current = new Set(ids || []);
    if (checked) current.add(id);
    else current.delete(id);
    onChange({ todos: false, ids: [...current] });
  }

  return (
    <div className="field">
      <span>Condomínios em que trabalha</span>
      <div className="escopo-condos stack">
        <label className="check-line">
          <input
            type="checkbox"
            checked={Boolean(todos)}
            onChange={(e) => setTodos(e.target.checked)}
          />
          <div>
            <strong>Todos os condomínios desta construtora</strong>
            <small>Marque se a pessoa atende o portfólio inteiro</small>
          </div>
        </label>

        {todos ? (
          <p className="hint">
            Desmarque se ela trabalha só em alguns condomínios. Dá para alterar depois, se isso mudar.
          </p>
        ) : (
          <>
            <p className="hint">
              Marque apenas os condomínios desta pessoa. Se no futuro ela passar a atender outros, edite o usuário.
            </p>
            {loadError ? <p className="hint">{loadError}</p> : null}
            <div className="escopo-condo-list">
              {!condos.length && !loadError ? (
                <p className="hint">Nenhum condomínio vinculado a esta construtora ainda.</p>
              ) : condos.map((row) => (
                <label key={row.id} className="check-line">
                  <input
                    type="checkbox"
                    checked={(ids || []).includes(row.id)}
                    onChange={(e) => toggleOne(row.id, e.target.checked)}
                  />
                  {row.nome}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
