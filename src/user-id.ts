/**
 * El identificador de un usuario como lo usa UTP: su código, en mayúsculas.
 *
 * El `preferred_username` del proveedor de identidad llega de dos formas, el
 * código solo (`e12345678`) o como una dirección (`u12345678@utp.edu.pe`), y
 * las dos tienen que dar la misma cadena. Es la que viaja entre capas en
 * `user-id` y la que se busca en los logs: si no coinciden, una consulta por
 * `U12345678` no encuentra las líneas del mismo alumno.
 *
 * Por eso se queda con lo que está antes de la primera arroba, en todos los
 * ambientes por igual. Lo que queda vacío -un `@utp.edu.pe` sin código- lo
 * rechaza la plataforma con 401, como un token que no describe a nadie.
 */
export function normalizeUtpUserId(raw: string): string {
  const [local = ''] = raw.trim().split('@');
  return local.trim().toUpperCase();
}
