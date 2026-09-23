/**
 * Las cabeceras con las que una petición viaja entre las capas internas de
 * UTP: la correlación, el usuario y su rol.
 *
 * No van en el perfil, y es a propósito. Un servicio que las declara las copia
 * de la petición que recibe a cada llamada que hace, y eso es lo correcto detrás
 * del BFF, donde quien las puso es otra capa. En el BFF sería copiar hacia
 * adentro lo que mande el cliente: un `user-role` escrito a mano llegaría a
 * negocio como si lo hubiera dicho el token.
 *
 * Por eso las declara el servicio interno que las necesita.
 *
 * @example
 * NovaModule.forRoot({
 *   profile: utpProfile,
 *   observability: { correlationHeaders: UTP_INTERNAL_HEADERS },
 * });
 */
export const UTP_INTERNAL_HEADERS = [
  'x-request-id',
  'user-id',
  'user-role',
] as const;
