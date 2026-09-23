import { utpProfile } from './profile';
import { normalizeUtpUserId } from './user-id';

describe('normalizeUtpUserId', () => {
  it.each([
    ['e12345678', 'E12345678'],
    ['u12345678@utp.edu.pe', 'U12345678'],
    ['  U12345678@UTP.EDU.PE  ', 'U12345678'],
    ['0123456', '0123456'],
    // La primera arroba corta: lo que venga después es dominio.
    ['al@ice@utp', 'AL'],
  ])('turns %s into %s', (raw, expected) => {
    expect(normalizeUtpUserId(raw)).toBe(expected);
  });

  // Un dominio sin código no describe a nadie. El normalizador no inventa un
  // valor: devuelve vacío y la plataforma contesta 401.
  it.each(['@utp.edu.pe', ' @ ', ''])('leaves nothing out of %j', (raw) => {
    expect(normalizeUtpUserId(raw)).toBe('');
  });
});

describe('utpProfile', () => {
  it('is named utp', () => {
    expect(utpProfile.name).toBe('utp');
  });

  // El orden importa: gana la primera variable que esté puesta, y en un
  // contenedor es APP_PORT.
  it('reads the port the task definition injects before PORT', () => {
    expect(utpProfile.bootstrap?.portVariables).toEqual(['APP_PORT', 'PORT']);
  });

  it('unfolds every secret that arrives under SECRET_', () => {
    expect(utpProfile.bootstrap?.secrets).toEqual({ prefix: 'SECRET_' });
  });

  // Las rutas de UTP llevan la versión en cada controlador.
  it('adds no global prefix', () => {
    expect(utpProfile.bootstrap?.globalPrefix).toBeUndefined();
  });

  it('keeps the route the target groups check', () => {
    expect(utpProfile.health?.legacyPath).toBe('api/v1/health');
  });

  it('carries only the correlation id from the incoming request', () => {
    expect(utpProfile.observability?.correlationHeaders).toEqual([
      'x-request-id',
    ]);
  });

  it('reads a Keycloak token and sends the user on as user-id', () => {
    expect(utpProfile.auth).toMatchObject({
      rolesClaim: 'realm_access.roles',
      ignoredRoles: ['offline_access', 'uma_authorization'],
      ignoredRolePrefixes: ['default-roles-'],
      normalizeId: normalizeUtpUserId,
      userIdHeader: 'user-id',
    });
  });
});
