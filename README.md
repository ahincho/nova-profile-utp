# @ahincho/nova-profile-utp

El perfil de organización de UTP para [Nova Platform](https://github.com/ahincho/nova-nestjs): las convenciones que comparten sus servicios NestJS, declaradas una sola vez.

Un perfil ajusta las implementaciones por defecto de Nova y nada más. Ve las mismas opciones que ve un servicio, así que no puede cambiar una regla del núcleo, y el orden es fijo: primero los defaults de Nova, después el perfil y al final el servicio, que sigue pudiendo cambiar cualquier cosa.

## Uso

```ts
// app.module.ts
import { NovaModule } from '@ahincho/nova-nestjs';
import { utpProfile } from '@ahincho/nova-profile-utp';

@Module({
  imports: [
    NovaModule.forRoot({
      profile: utpProfile,
      auth: { preferredRoles: ['student'] },
    }),
  ],
})
export class AppModule {}
```

```ts
// main.ts
import { bootstrap } from '@ahincho/nova-nestjs';
import { utpProfile } from '@ahincho/nova-profile-utp';

void bootstrap(AppModule, { profile: utpProfile });
```

El perfil va en los dos lugares porque los secretos se desdoblan antes de que exista la aplicación. Si no coinciden, el arranque se detiene.

Un servicio detrás del BFF, que pasa hacia abajo la identidad que le puso la capa de arriba, declara además sus cabeceras:

```ts
import { UTP_INTERNAL_HEADERS, utpProfile } from '@ahincho/nova-profile-utp';

NovaModule.forRoot({
  profile: utpProfile,
  observability: { correlationHeaders: UTP_INTERNAL_HEADERS },
});
```

## Qué declara

| Convención                 | Valor                                | Por qué                                                                                                       |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Puerto                     | `APP_PORT`, y si no está, `PORT`     | La task definition inyecta `APP_PORT`; `PORT` es el que fija el Dockerfile.                                   |
| Secretos                   | toda variable `SECRET_*` se desdobla | Cada secreto de Secrets Manager llega entero, como un JSON, en una sola variable.                             |
| Sonda de los target groups | `/api/v1/health`                     | Es la ruta que revisa el balanceador; se sirve junto a `/health/live` y `/health/ready`.                      |
| Correlación                | `x-request-id`                       | Es la única cabecera que se copia de la petición que llega.                                                   |
| Roles                      | `realm_access.roles`                 | El proveedor de identidad es Keycloak. No cuentan `offline_access`, `uma_authorization` ni `default-roles-*`. |
| Usuario                    | el código, en mayúsculas             | `u12345678@utp.edu.pe` y `u12345678` son el mismo alumno, en todos los ambientes.                             |
| Usuario hacia otras capas  | la cabecera `user-id`                | Es el nombre que leen orquestación y negocio.                                                                 |

## Qué no declara, a propósito

- **Prefijo global.** Las rutas de UTP llevan la versión en cada controlador (`v1/student/...`, `v1/internal/acl/...`), y un prefijo movería rutas de las que ya dependen las otras capas.
- **Autenticación.** El perfil dice cómo se lee un token; pedirlo lo decide cada servicio declarando `auth`.
- **Rol preferido.** Depende del servicio: un BFF de alumnos prefiere `student`.
- **Identidad copiada de la petición.** `user-id` y `user-role` no están entre las cabeceras del perfil, porque en un BFF se copiarían de lo que mande el cliente: un `user-role` escrito a mano llegaría a negocio como si lo hubiera dicho el token. Los servicios internos las declaran con `UTP_INTERNAL_HEADERS`.
- **Estándar de API.** Queda el de Nova: el sobre `{ success, status, data, errors }` y su catálogo de códigos, que son los que ya usan los servicios de UTP.

## Errores de upstream

Nova clasifica cada fallo al llamar a otro servicio con los tipos de error de [RFC 9209](https://www.rfc-editor.org/rfc/rfc9209) y los agrupa por categoría: conectividad, timeout, red, respuesta, contrato e interno. El cliente recibe un mensaje genérico, y el detalle -el host, el tipo, la fase y cuánto tardó- va al log con el mismo `traceId`. El perfil no cambia nada de eso.

Quedan por decidir para UTP:

- si los 5xx llevan un código propio, como `BAD_GATEWAY` o `GATEWAY_TIMEOUT`, en vez de responder todos `INTERNAL_SERVER_ERROR`;
- los nombres de los campos del log que se consultan en OpenSearch;
- si el borde expone la cabecera `Proxy-Status`.

## Lo que el perfil todavía no puede declarar

Dos convenciones de UTP que Nova hoy no puede expresar. Mientras tanto, un BFF de UTP las resuelve en su propio código.

1. **La correlación del borde.** El BFF recibe `transaction-id` del frontend, lo exige como UUID, lo devuelve en la respuesta y lo pasa hacia adentro como `x-request-id`. Nova lee y reenvía la misma cabecera, y genera un id si falta.
2. **El rol hacia las otras capas.** Los servicios de UTP pasan el rol del usuario en `user-role`, y la autenticación de Nova solo propaga el id.

## Compatibilidad

Requiere `@ahincho/nova-nestjs` 0.16, la primera versión con perfiles. Como esa versión todavía no está publicada, el repositorio aún no tiene lockfile.

## Licencia

[EPL-2.0](LICENSE)
