# MISTCUT Cloud

Backend autoritativo para contas, dispositivos, créditos, planos e Stripe.

Arquitetura:
- O vídeo continua sendo processado localmente pelo aplicativo Windows.
- O saldo nunca é calculado pelo cliente.
- Antes de processar, o aplicativo reserva créditos no Cloud.
- A reserva debita o saldo disponível imediatamente e fica marcada como pendente.
- Ao concluir, o aplicativo confirma a reserva.
- Em falha real de processamento, o aplicativo solicita o reembolso.
- Fechar o aplicativo ou cortar a internet não devolve créditos automaticamente.

Fluxo local:
1. Copie .env.example para .env.
2. Configure DATABASE_URL.
3. Instale dependências com npm install.
4. Rode npm run prisma:generate.
5. Rode npm run prisma:migrate.
6. Rode npm run seed.
7. Rode npm run dev.

Para criar o primeiro administrador, configure MISTCUT_ADMIN_EMAIL e MISTCUT_ADMIN_PASSWORD antes de executar npm run seed.

Stripe:
- Configure os Price IDs somente no backend.
- Configure o webhook para /v1/stripe/webhook.
- Eventos principais: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated e customer.subscription.deleted.
- O webhook usa a assinatura STRIPE_WEBHOOK_SECRET.
- Créditos vindos do Stripe são idempotentes por event ID.

Desktop:
Configure no .env principal:
MISTCUT_CLOUD_API_URL=http://localhost:4100
MISTCUT_WEB_URL=http://localhost:3000

Em produção use HTTPS. Nunca coloque STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET ou DATABASE_URL dentro do aplicativo distribuído.
