/**
 * Create or update a user (e.g. the read-only accountant) WITHOUT touching any other data.
 *
 *   node scripts/create-user.js <username> <ROLE> <password>
 *   ROLE = OWNER | MANAGER | ACCOUNTANT
 *
 * Uses DATABASE_URL from .env. Password is bcrypt-hashed (cost 10) like the login expects.
 */
require('dotenv').config?.();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const [username, roleArg, password] = process.argv.slice(2);
const ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT'];

(async () => {
  const role = (roleArg || '').toUpperCase();
  if (!username || !password || !ROLES.includes(role)) {
    console.error('Usage: node scripts/create-user.js <username> <OWNER|MANAGER|ACCOUNTANT> <password>');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Use a password of at least 10 characters.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
      where: { username },
      create: { username, password: hash, role },
      update: { password: hash, role }
    });
    console.log(`OK: ${user.username} -> ${user.role}`);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
