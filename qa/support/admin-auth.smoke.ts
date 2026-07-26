import jwt from 'jsonwebtoken';
import { adminAuth } from './admin-auth';

async function main(): Promise<void> {
  const token = await adminAuth();
  const decoded = jwt.decode(token) as { role?: string } | null;
  if (!decoded || decoded.role !== 'admin') {
    console.error('FAIL: el token no tiene claim role=admin');
    process.exit(1);
  }
  console.log(`OK: JWT role=admin obtenido (${token.slice(0, 24)}…)`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
