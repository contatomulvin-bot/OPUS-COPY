# MISTCUT Cloud

Backend autoritativo para contas, dispositivos, créditos, planos, Stripe e análise de IA.

## Arquitetura

- O vídeo continua sendo processado localmente pelo aplicativo Windows.
- O Desktop usa HTTP leve e não precisa carregar SDK do Supabase ou Stripe.
- Supabase Auth é a autoridade de identidade, confirmação de e-mail, senha e refresh token.
- O Cloud sincroniza o usuário autenticado para a camada comercial do MISTCUT.
- O saldo, o plano e a cobrança de créditos nunca são calculados pelo cliente.
- A etapa de análise de IA faz reserva/commit/refund no servidor com idempotência.

Produção:
- Site: https://www.mistcut.com
- API: https://api.mistcut.com

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Configure `DATABASE_URL` para PostgreSQL.
3. Configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.
4. Rode `npm install`.
5. Rode `npm run prisma:generate`.
6. Rode `npm run prisma:migrate`.
7. Rode `npm run seed`.
8. Rode `npm run dev`.

Para desenvolvimento local, sobrescreva:
- `WEB_URL=http://localhost:3000`
- `CORS_ORIGINS=http://localhost:3000,http://localhost:5173`

## SUPER ADMIN

Senhas não são mais mantidas pelo Cloud. Para bootstrap do primeiro dono, configure no backend:

`MISTCUT_SUPER_ADMIN_EMAILS=seu-email@dominio.com`

Quando esse usuário entrar por Supabase Auth, o registro comercial será sincronizado como `SUPER_ADMIN`.
Depois disso, roles devem ser administradas somente por rotas protegidas do backend.

## Stripe

- Configure os Price IDs somente no backend.
- Configure o webhook de produção para `https://api.mistcut.com/v1/stripe/webhook`.
- Eventos principais: `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated` e
  `customer.subscription.deleted`.
- O webhook valida `STRIPE_WEBHOOK_SECRET`.
- Créditos vindos do Stripe são idempotentes por event ID.

## Desktop

Produção:

`MISTCUT_CLOUD_API_URL=https://api.mistcut.com`

`MISTCUT_WEB_URL=https://www.mistcut.com`

O Desktop envia a senha somente ao endpoint de autenticação do MISTCUT Cloud; o Cloud
encaminha a autenticação ao Supabase e devolve a sessão. O refresh token é protegido no
Windows com DPAPI. Nenhuma chave secreta do Supabase, Stripe, banco ou Gemini é
distribuída no executável.
