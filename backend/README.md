# NaijaPay API

Express + TypeScript + Prisma/PostgreSQL backend for the Nigerian fintech prototype.

## Setup
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and configure PostgreSQL and a strong `JWT_SECRET`.
3. Run `npm install`.
4. Run `npx prisma generate`.
5. Run `npx prisma migrate dev --name init`.
6. Run `npm run dev`.

## API
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/transactions`
- `POST /api/wallet/fund`
- `POST /api/transfers`
- `POST /api/payments/webhook`
- `GET /api/admin/summary`

## Payment integration
`/api/wallet/fund` creates a pending funding transaction. The actual provider checkout and webhook verification must be implemented with a licensed provider such as Flutterwave or Paystack. Provider secret keys must remain server-side. Never credit a wallet from an unverified client request.

## Production requirements
Before handling real customer funds, add KYC/AML workflows, MFA/OTP, rate limiting, device/session controls, webhook signature verification, idempotency keys, a proper double-entry ledger, reconciliation, immutable audit logs, transfer-name/account validation, fraud monitoring, encryption/key management, backups, monitoring, and compliance/licensing review for Nigeria.
