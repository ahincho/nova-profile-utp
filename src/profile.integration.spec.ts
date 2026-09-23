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
  RequestContextService,
  bootstrap,
  type Principal,
} from '@ahincho/nova-nestjs';
import { UTP_INTERNAL_HEADERS } from './headers';
import { utpProfile } from './profile';

type Outbound = Record<string, string>;

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
  controllers: [StudentController],
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
// que le puso la capa de arriba.
@Module({
  imports: [
    NovaModule.forRoot({
      profile: utpProfile,
      observability: {
        correlationHeaders: UTP_INTERNAL_HEADERS,
        logger: false,
      },
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
  });
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

  it('sends the correlation id and the user on to the next layer', async () => {
    const response = await fetch(`${url}/v1/student/me`, {
      headers: {
        authorization: `Bearer ${studentToken}`,
        'x-request-id': '5f0c2a8e-8a4e-4a7e-9d59-3b7a4f1c2d10',
      },
    });

    const body = (await response.json()) as { data: { outbound: Outbound } };
    expect(body.data.outbound).toEqual({
      'x-request-id': '5f0c2a8e-8a4e-4a7e-9d59-3b7a4f1c2d10',
      'user-id': 'U12345678',
    });
  });

  // Lo que el cliente escriba a mano no pasa: el usuario sale del token, y el
  // rol no se copia de la petición.
  it('never forwards an identity the client wrote itself', async () => {
    const response = await fetch(`${url}/v1/student/me`, {
      headers: {
        authorization: `Bearer ${studentToken}`,
        'user-id': 'SOMEONE-ELSE',
        'user-role': 'admin',
      },
    });

    const body = (await response.json()) as { data: { outbound: Outbound } };
    expect(body.data.outbound['user-id']).toBe('U12345678');
    expect(body.data.outbound).not.toHaveProperty('user-role');
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
        'x-request-id': '5f0c2a8e-8a4e-4a7e-9d59-3b7a4f1c2d10',
        'user-id': 'U12345678',
        'user-role': 'student',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        'x-request-id': '5f0c2a8e-8a4e-4a7e-9d59-3b7a4f1c2d10',
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
