# Database Setup

Use this guide when setting up `api/documents` after cloning the project.

## Ownership

`api/documents` uses the shared database at runtime, but it does not own
migrations. Run schema migrations and Prisma generation from `api/database`.

## Required Role

Use this Neon runtime role:

```text
gracon_documents_app
```

This role should connect to the same Neon database as the other APIs, but it
must not be the owner or migration role.

## 1. Prepare The Database Package

From `api/database`, install dependencies, generate the shared Prisma client,
build it, and apply migrations:

```bash
npm install
npm run prisma:generate
npm run build
npm run migrate:deploy
```

## 2. Create Or Reset The Neon Role

In the Neon SQL Editor, create or reset the role password:

```sql
CREATE ROLE gracon_documents_app LOGIN PASSWORD 'replace_with_documents_password';
```

If it already exists:

```sql
ALTER ROLE gracon_documents_app WITH PASSWORD 'replace_with_documents_password';
```

Grant runtime permissions using `api/database/docs/runtime-database-roles.md`.

## 3. Configure `DATABASE_URL`

Use the Neon pooled hostname with `-pooler`:

```env
DATABASE_URL=postgresql://gracon_documents_app:password@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
```

If the password has symbols, URL-encode it:

```bash
node -e "console.log(encodeURIComponent(process.argv[1]))" 'your_password'
```

## 4. Install And Start

```bash
npm install
npm run build
npm run start:dev
```

If startup fails with `P1000`, the role name, branch, or password is wrong. If
it fails with `permission denied`, the role exists but grants are missing.
