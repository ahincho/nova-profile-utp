import { defineProfile } from '@ahincho/nova-nestjs';
import { normalizeUtpUserId } from './user-id';

/**
 * Las convenciones que comparten los servicios de UTP, declaradas una vez.
 *
 * Cada valor está acá porque todos los servicios de la organización lo
 * escriben igual; lo que cambia de uno a otro -sus upstreams, sus chequeos, si
 * pide token, qué rol prefiere- lo declara cada uno.
 *
 * @example
 * NovaModule.forRoot({ profile: utpProfile, config: { load: [academic] } });
 * void bootstrap(AppModule, { profile: utpProfile });
 */
export const utpProfile = defineProfile({
  name: 'utp',

  bootstrap: {
    // APP_PORT es lo que la task definition inyecta desde el puerto del
    // contenedor, y PORT el que fija el Dockerfile. Va primero APP_PORT para
    // que un cambio de puerto en la infraestructura no deje al health check
    // apuntando a un puerto donde la aplicación no escucha.
    portVariables: ['APP_PORT', 'PORT'],

    // Cada secreto de Secrets Manager llega entero, como un JSON, en una
    // variable que empieza con SECRET_. El prefijo es lo que deja agregar uno
    // nuevo sin tocar ningún servicio.
    secrets: { prefix: 'SECRET_' },

    // Sin prefijo global, a propósito: la versión va escrita en cada
    // controlador -`v1/student/...`, `v1/internal/acl/...`-, y un prefijo
    // movería rutas de las que ya dependen las otras capas.
  },

  health: {
    // La ruta que revisan los target groups del balanceador. Se sirve junto a
    // /health/live y /health/ready y no se mueve: moverla pide cambiar el
    // target group de cada servicio.
    legacyPath: 'api/v1/health',
  },

  observability: {
    // Lo que viaja entre capas: la correlación, el usuario y su rol. En un BFF
    // el usuario y el rol salen del token y nunca de la petición, porque los
    // escribe la autenticación; en un servicio interno, que no declara `auth`,
    // se copian de lo que puso la capa de arriba.
    correlationHeaders: ['x-request-id', 'user-id', 'user-role'],

    // El frontend manda el id como transaction-id y lo espera de vuelta con ese
    // nombre; hacia adentro viaja como x-request-id. Aceptar los dos es lo que
    // deja que el mismo perfil sirva al BFF y a los servicios de adentro.
    requestId: { accept: ['transaction-id', 'x-request-id'] },
  },

  auth: {
    // El proveedor de identidad es Keycloak: los roles del realm van en
    // realm_access.roles, y estos tres describen lo que el token puede hacer,
    // no quién lo trae.
    rolesClaim: 'realm_access.roles',
    ignoredRoles: ['offline_access', 'uma_authorization'],
    ignoredRolePrefixes: ['default-roles-'],
    normalizeId: normalizeUtpUserId,

    // Los nombres con que el usuario y su rol viajan hacia las otras capas, que
    // son los que leen orquestación y negocio.
    userIdHeader: 'user-id',
    roleHeader: 'user-role',
  },
});
