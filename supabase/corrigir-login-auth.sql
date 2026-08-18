-- Cole e execute isto no SQL Editor (arquivo inteiro, No limit).
-- Corrige o 500 no login do usuário criado via SQL.

UPDATE auth.users
SET
  confirmation_token = '',
  recovery_token = '',
  email_change_token_new = '',
  email_change = '',
  email_change_token_current = '',
  reauthentication_token = '',
  phone_change = '',
  phone_change_token = ''
WHERE lower(email) = 'gestao@seudominio.com';
