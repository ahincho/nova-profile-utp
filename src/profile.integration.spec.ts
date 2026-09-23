import {
  Controller,
  Get,
  Module,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import {
  CurrentUser,
  NovaModule,
  Public,
  RequestContextService,
  bootstrap,
  type Principal,
} from '@ahincho/nova-nestjs';
import { utpProfile } from './profile';

type Outbound = Record<string, string>;

const ORIGIN = 'https://nova.example.edu';
const TRANSACTION_ID = '5f0c2a8e-8a4e-4a7e-9d59-3b7a4f1c2d10';

@Controller('v1/student/me')
class StudentController {
  constructor(private readonly context: RequestContextService) {}

  @Get()
  me(@CurrentUser() user: Principal): {
    id: string;
    role: string;
    outbound: Outbound;
  } {
    return { id: user.id, role: user.role, outbound: this.context.headers() };
  }
}

@Controller('v1/student/banners')
class BannersController {
  constructor(private readonly context: RequestContextService) {}

  @Public()
  @Get()
  banners(): Outbound {
    return this.context.headers();
  }
}

// Un BFF: pide token, y lo que sabe del usuario sale de ahí.
@Module({
  imports: [
    NovaModule.forRoot({
      profile: utpProfile,
      // El perfil dice cómo se lee el token; pedirlo es decisión del servicio.
      auth: { preferredRoles: ['student'] },
      observability: { logger: false },
    }),
  ],
  controllers: [StudentController, BannersController],
})
class StudentBffModule {}

@Controller('v1/internal/business/echo')
class EchoController {
  constructor(private readonly context: RequestContextService) {}

  @Get()
  echo(): Outbound {
    return this.context.headers();
  }
}

// Un servicio detrás del BFF: no pide token, y pasa hacia abajo la identidad
// que le puso la capa de arriba. No declara nada más que el perfil.
@Module({
  imports: [
    NovaModule.forRoot({
      profile: utpProfile,
      observability: { logger: false },
    }),
  ],
  controllers: [EchoController],
})
class InternalServiceModule {}

const silent: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
  fatal: () => undefined,
};

/** Un token como los que emite el Keycloak de la organización, sin firmar. */
function keycloakToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

const studentToken = keycloakToken({
  preferred_username: 'u12345678@utp.edu.pe',
  realm_access: {
    roles: ['default-roles-nova', 'offline_access', 'teacher', 'student'],
  },
});

async function start(module: unknown): Promise<INestApplication> {
  return bootstrap(module, {
    profile: utpProfile,
    port: 0,
    host: '127.0.0.1',
    logger: silent,
    cors: { origins: ORIGIN },
  });
}

async function outbound(response: Response): Promise<Outbound> {
  const body = (await response.json()) as { data: { outbound: Outbound } };
  return body.data.outbound;
}

// Servicios de UTP de punta a punta: el perfil pasa por bootstrap() y por
// NovaModule como en producción, y lo que se mira es lo que se ve desde afuera.
describe('a UTP BFF', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    process.env['SECRET_DB'] = JSON.stringify({ DB_HOST: 'academic.internal' });
    app = await start(StudentBffModule);
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    delete process.env['SECRET_DB'];
    delete process.env['DB_HOST'];
  });

  it('unfolds the secrets the task definition injects', () => {
    expect(process.env['DB_HOST']).toBe('academic.internal');
  });

  it('knows the student by their code and by the role they prefer', async () => {
    const response = await fetch(`${url}/v1/student/me`, {
      headers: { authorization: `Bearer ${studentToken}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: 'U12345678', role: 'student' },
    });
  });

  // El frontend manda transaction-id y lo espera de vuelta con ese nombre;
  // hacia adentro viaja como x-request-id, junto con el usuario y su rol.
  it('takes the transaction id, gives it back and sends it on inward', async () => {
    const response = await fetch(`${url}/v1/student/me`, {
      headers: {
        authorization: `Bearer ${studentToken}`,
        'transaction-id': TRANSACTION_ID,
      },
    });

    expect(response.headers.get('transaction-id')).toBe(TRANSACTION_ID);
    expect(await outbound(response)).toEqual({
      'x-request-id': TRANSACTION_ID,
      'user-id': 'U12345678',
      'user-role': 'student',
    });
  });

  // Lo que el cliente escriba a mano no pasa: el usuario y el rol salen del
  // token.
  it('replaces an identity the client wrote with the one in the token', async () => {
    const response = await fetch(`${url}/v1/student/me`, {
      headers: {
        authorization: `Bearer ${studentToken}`,
        'user-id': 'SOMEONE-ELSE',
        'user-role': 'admin',
      },
    });

    expect(await outbound(response)).toMatchObject({
      'user-id': 'U12345678',
      'user-role': 'student',
    });
  });

  // En una ruta pública no hay token del que salga una identidad, y la que
  // mande el cliente no viaja.
  it('forwards no identity from a public route', async () => {
    const response = await fetch(`${url}/v1/student/banners`, {
      headers: {
        'transaction-id': TRANSACTION_ID,
        'user-id': 'SOMEONE-ELSE',
        'user-role': 'admin',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { 'x-request-id': TRANSACTION_ID },
    });
  });

  // Si el navegador no puede mandar transaction-id, o el script no puede leer
  // el que vuelve, aceptarlo no sirve de nada.
  it('lets the browser send the transaction id and read it back', async () => {
    const preflight = await fetch(`${url}/v1/student/me`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,transaction-id',
      },
    });
    const response = await fetch(`${url}/v1/student/banners`, {
      headers: { origin: ORIGIN, 'transaction-id': TRANSACTION_ID },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(
      'transaction-id',
    );
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'transaction-id',
    );
  });

  it('turns away a request without a token', async () => {
    expect((await fetch(`${url}/v1/student/me`)).status).toBe(401);
  });

  // El target group revisa esta ruta: tiene que contestar sin token.
  it('answers the route the target groups check', async () => {
    expect((await fetch(`${url}/api/v1/health`)).status).toBe(200);
  });

  it('answers the probes', async () => {
    expect((await fetch(`${url}/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/health/ready`)).status).toBe(200);
  });
});

describe('a UTP service behind the BFF', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    app = await start(InternalServiceModule);
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes on the identity the layer above put on the request', async () => {
    const response = await fetch(`${url}/v1/internal/business/echo`, {
      headers: {
        'x-request-id': TRANSACTION_ID,
        'user-id': 'U12345678',
        'user-role': 'student',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        'x-request-id': TRANSACTION_ID,
        'user-id': 'U12345678',
        'user-role': 'student',
      },
    });
  });

  it('opens a correlation id when the caller sent none', async () => {
    const response = await fetch(`${url}/v1/internal/business/echo`);

    const body = (await response.json()) as { data: Outbound };
    expect(body.data['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
