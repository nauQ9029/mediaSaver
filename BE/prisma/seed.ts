import { prisma } from '../src/lib/prisma.js';
import bcrypt from 'bcryptjs';

async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12 || password.length > 72) {
    throw new Error('Set DEMO_PASSWORD to a 12–72 character password before running the seed.');
  }

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      id: 'demo-user-9029',
      email: 'demo@example.com',
      password: await bcrypt.hash(password, 10),
    },
  });

  console.log('Seed user created:', demoUser.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
