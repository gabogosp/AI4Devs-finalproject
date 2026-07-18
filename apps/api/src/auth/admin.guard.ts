import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/**
 * Seam mínimo de auth admin (ADR-0009). Valida la firma del JWT con `JWT_SECRET`
 * y exige el claim `role=admin`. US-014 endurece la EMISIÓN (login, cookie
 * httpOnly, refresh rotado, rate-limit, 2FA) **preservando** este contrato
 * `role=admin` — sin reescribir el guard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(req);
    if (!token) {
      throw new UnauthorizedException('Falta el token de administración');
    }

    let payload: { role?: string };
    try {
      payload = await this.jwt.verifyAsync<{ role?: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.role !== 'admin') {
      throw new ForbiddenException('Se requiere rol de administrador');
    }
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() || null;
    }
    return null;
  }
}
