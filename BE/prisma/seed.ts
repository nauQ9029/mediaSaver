import { prisma } from '../src/lib/prisma.js';

async function main() {
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      id: 'demo-user-9029', // Fixed ID for Postman testing
      email: 'demo@example.com',
      password: 'hashed_password_here', // Placeholder until auth is built
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