-- Libera a capa em alta qualidade no Storage (até 25 MB).
-- Documentos e as outras imagens continuam no mesmo bucket.
-- Rode o ARQUIVO INTEIRO.

UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = NULL
WHERE id = 'condominios';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('condominios', 'condominios', false, 26214400, NULL)
ON CONFLICT (id) DO UPDATE
SET file_size_limit = 26214400,
    allowed_mime_types = NULL;
