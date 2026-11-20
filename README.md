# CR Perfumería & Limpieza — Tienda Online

## Descripción del proyecto

Estamos desarrollando una tienda online para CR Perfumería & Limpieza. La plataforma permitirá que los clientes se registren, ingresen al catálogo, seleccionen productos, indiquen las cantidades que desean comprar, armen un carrito, elijan dónde retirar su pedido y seleccionen un medio de pago.

La tienda debe estar conectada con el sistema de gestión que el negocio ya utiliza. No queremos desarrollar un sistema independiente ni duplicar información.

## Estructura de carpetas y proyectos

Actualmente tenemos dos carpetas:

**1. `gestionlocallimpieza`**

Este es el proyecto de gestión que ya está terminado y funcionando.

**NO MODIFICAR ESTA CARPETA BAJO NINGUNA CIRCUNSTANCIA.**

No modificar archivos, componentes, configuraciones, dependencias ni código de este proyecto. Tampoco realizar migraciones o modificaciones desde este proyecto.

Su única función es servir como referencia para comprender cómo está construido el sistema actual y cómo funciona su base de datos.

**2. `catalogolimpieza`**

Esta es la carpeta en la que vamos a trabajar.

Todo el desarrollo de la tienda online debe realizarse exclusivamente dentro de esta carpeta.

No desarrollar funcionalidades de la tienda dentro de `gestionlocallimpieza`, ni utilizarla como destino de archivos nuevos.

### Conexión entre ambos proyectos

Los dos proyectos utilizarán el mismo proyecto de Supabase y, por lo tanto, compartirán la misma base de datos.

La carpeta `gestionlocallimpieza` contiene la implementación del sistema de gestión y nos sirve para conocer la estructura actual de esa base de datos.

La carpeta `catalogolimpieza` contendrá la nueva tienda online.

**Es fundamental que comprendas que los productos que ya están registrados en `gestionlocallimpieza` deben aparecer automáticamente en el catálogo de la nueva tienda.**

Ya existe una cantidad considerable de productos cargados en la base de datos. Debés identificar cómo están almacenados, cómo se relacionan con sus categorías, cómo se manejan sus precios y cómo obtener sus imágenes.

**PROHIBIDO ELIMINAR, VACIAR, REEMPLAZAR O SOBRESCRIBIR LOS PRODUCTOS EXISTENTES.**

No borrar registros, no reiniciar tablas, no utilizar comandos destructivos ni realizar operaciones que puedan provocar pérdida de información.

La tienda debe consultar y reutilizar los productos existentes. No queremos volver a cargar manualmente el catálogo.

Si necesitás adaptar la estructura de la base de datos para incorporar funcionalidades nuevas, hacelo mediante migraciones controladas, preservando todos los registros y relaciones existentes.

Antes de modificar cualquier estructura compartida, verificá el impacto que tendrá sobre el sistema de gestión y explicá los cambios propuestos.

## Infraestructura existente

Ya tenemos un proyecto de Supabase con una base de datos PostgreSQL que utiliza el sistema de gestión actual.

Debés investigar su estructura utilizando `gestionlocallimpieza` como referencia.

Revisá las tablas, relaciones, políticas RLS, autenticación y funciones existentes. No crees otra base de datos ni dupliques tablas de productos.

También utilizaremos:
- Supabase para base de datos, autenticación y backend.
- Mercado Pago para los pagos online.
- Un servicio de hosting para publicar la aplicación.

## Diseño e identidad visual

La identidad visual debe respetar el logo de CR Perfumería & Limpieza.

El diseño será negro y dorado, elegante, moderno y minimalista. Debe estar completamente adaptado a computadoras y celulares.

Las imágenes de referencia compartidas representan el estilo visual que queremos conseguir.

La página principal tendrá un carrusel de ofertas y debajo una sección de Productos Destacados. También habrá un catálogo completo con categorías y buscador.

Los productos se mostrarán mediante tarjetas con fotografía, nombre, precio, precio anterior cuando tengan descuento e indicador de oferta. No queremos banners tradicionales ni una interfaz sobrecargada de botones.

## Registro y usuarios

La primera vez que una persona ingrese deberá registrarse con nombre completo, correo electrónico y contraseña.

La autenticación debe utilizar Supabase Auth, salvo que exista una implementación que convenga reutilizar.

Los usuarios podrán iniciar sesión, cerrar sesión y recuperar su contraseña. La sesión deberá mantenerse entre visitas.

Cada cliente tendrá acceso únicamente a su propia información y sus compras.

## Productos y catálogo

Los productos y precios deben obtenerse de las tablas existentes en Supabase, manteniendo la conexión con el sistema de gestión.

La ficha individual de cada producto será minimalista y mostrará solamente fotografía, nombre, precio actual, precio anterior si corresponde y un selector de cantidades (+ / -), junto con el botón «Agregar al carrito».

No incluir descripciones ni características técnicas.

Los productos ya registrados deben poder visualizarse en la tienda sin necesidad de volver a cargarlos.

## Carrito de compras

El carrito debe acompañar al usuario mientras navega por la tienda.

Cuando agregue el primer producto aparecerá una notificación indicando «¡Iniciaste una compra!». Luego se transformará en un panel fijo en la parte inferior de la pantalla.

Este panel mostrará la cantidad de artículos, el importe acumulado y un botón «Finalizar compra».

Cada producto agregado actualizará automáticamente el carrito. El usuario podrá modificar cantidades, eliminar artículos y consultar el importe total.

El carrito debe conservarse aunque el usuario cierre la página o vuelva a ingresar.

Es importante diferenciar un carrito en construcción de un pedido confirmado. No se debe generar un pedido definitivo cada vez que se agrega un producto.

## Checkout y métodos de pago

Al finalizar la compra, el cliente verá un resumen con los productos, cantidades, precios e importe total.

Luego deberá seleccionar un punto de retiro:

- Coto Lanús.
- Ciclón Caraza.
- UPA Recondo.
- Maxi Carrefour.
- Santa Marta.

Los medios de pago disponibles serán:

- **Mercado Pago:** pago online mediante redirección al checkout.
- **Transferencia bancaria:** con posibilidad de presentar un comprobante para verificar el pago.
- **Efectivo:** pago al momento de retirar.

Una vez confirmado el pedido, se guardará en Supabase toda la información necesaria: cliente, productos, cantidades, precios al momento de la compra, total, punto de retiro, método de pago, estado del pedido y fecha.

Los precios deben quedar registrados como una copia de los valores vigentes al momento de comprar.

## Mercado Pago

La integración debe realizarse mediante el backend, utilizando credenciales protegidas en variables de entorno o secretos de Supabase.

Nunca exponer Access Tokens en el frontend.

Utilizar credenciales de prueba durante el desarrollo. La operación debe quedar vinculada al pedido correspondiente y su estado debe verificarse mediante notificaciones de Mercado Pago y validación desde el backend.

No considerar un pago exitoso solamente porque el usuario regresa a una página de confirmación.

Si ya existe una implementación previa de Mercado Pago en el repositorio, revisarla y reutilizarla cuando corresponda.

## Integración con el sistema de gestión

La tienda debe compartir la información necesaria con el sistema de gestión existente.

Los productos se consultan desde las tablas actuales y las compras nuevas deben quedar disponibles para que el negocio pueda administrarlas desde su sistema.

Los pedidos deben incluir los datos del cliente, productos, cantidades, total, punto de retiro, método de pago y estados correspondientes.

También queremos aprovechar el sistema de notificaciones que ya existe para informar al negocio cuando ingrese una nueva compra.

No desarrollar funcionalidades duplicadas si ya están resueltas en el sistema actual.

## Seguridad y funcionamiento

Implementar correctamente las políticas RLS de Supabase, protegiendo los datos personales y las compras de cada usuario.

Los clientes no deben poder modificar precios, estados de pago ni información administrativa desde el frontend. Las operaciones importantes deben validarse en el backend.

Contemplar estados como pendiente de pago, pendiente de verificación, pagado, pendiente de preparación, listo para retirar, entregado y cancelado.

## Indicaciones para trabajar

Trabajá exclusivamente dentro de `catalogolimpieza`.

Podés inspeccionar `gestionlocallimpieza` para comprender su estructura, pero nunca modificarla.

Antes de programar, comprendé cómo funciona la base de datos existente y cómo obtener los productos que ya están registrados.

No necesito un análisis excesivamente extenso ni que conviertas cada apartado de este README en una tarea independiente.

Quiero que identifiques qué podemos reutilizar y qué modificaciones son realmente necesarias para completar la tienda.

Evitá reescribir componentes que ya funcionan, crear estructuras duplicadas o agregar dependencias innecesarias.

Cualquier modificación de la base de datos compartida debe ser cuidadosamente evaluada, porque también afecta al sistema de gestión terminado.

**Nunca eliminar productos ni información existente. No ejecutar operaciones destructivas.**

## Objetivo final

Tener una tienda online funcional dentro de `catalogolimpieza`, conectada al mismo Supabase que utiliza `gestionlocallimpieza`.

El cliente podrá registrarse, explorar los productos existentes, comprar, elegir dónde retirar y pagar.

El negocio recibirá los pedidos organizados dentro de su sistema de gestión actual.

La prioridad es reutilizar la infraestructura existente, mantener intacto el proyecto terminado y desarrollar la nueva tienda sin perder absolutamente ningún dato.

## Primera versión de la tienda

La aplicación inicial está hecha con React y Vite. El endpoint `GET /api/catalog/products`
lee `public.shop_products` desde el servidor y solo devuelve los campos necesarios para
mostrar el catálogo. La clave `SUPABASE_SECRET_KEY` se usa exclusivamente en el servidor;
nunca debe tener el prefijo `VITE_` ni incluirse en el bundle del navegador.

Para desarrollo local:

1. Copiá `.env.example` como `.env.local`.
2. Configurá `SUPABASE_URL` y `SUPABASE_SECRET_KEY` para la API del servidor.
3. Para registro e inicio de sesión, completá también `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY` con la URL y clave pública de Supabase.
4. Corré `npm install` y después `npm run dev`.

El catálogo usa `shop_products` como fuente de productos, precios, categorías e imágenes.
Los productos sin stock o sin precio se muestran, pero no se pueden agregar al carrito.
El carrito de esta versión se conserva en el dispositivo mediante almacenamiento local.

El esquema compartido original no tiene tablas de pedidos online, puntos de retiro ni estados
de pago. El carrito es local y no modifica stock. El flujo temporal descrito abajo permanece
cerrado hasta que se revise y aplique su migración aditiva; no reutiliza `shop_purchases`.

## Borrador del flujo de pedidos y pagos

El código inicial incluye una ruta temporal de pedidos, un panel de lectura para el local y
una migración **borrador** en `supabase/migrations/202611180001_online_orders.sql`. La migración
agrega `web_orders` y `web_order_items`; no cambia productos, categorías ni compras existentes.
No fue aplicada a Supabase. Revisarla antes de decidir si se aplica.

El servidor valida la sesión del cliente, relee precio y stock vigentes desde `shop_products`,
guarda una copia de nombre, imagen, cantidad y precio, y recién entonces solicita una orden de
Checkout Pro Orders API. El navegador no envía importes autoritativos ni puede marcar pagos como
pagados. El estado pagado solo se establece después de verificar la firma de un webhook y
consultar la orden directamente con Mercado Pago. El regreso del checkout solo muestra el estado
que ya confirmó el servidor. No se descuenta stock ni se escriben datos en `shop_purchases`.

Para mantenerlo cerrado, el checkout exige el Access Token y el ID de la cuenta vendedora de
prueba, un secreto de firma de Webhooks y comprueba esa identidad contra Mercado Pago. Mercado Pago configura los eventos de órdenes en el panel de la
aplicación y debe apuntar a `/api/orders/webhook`. El panel temporal «Pedidos del local» es de
solo lectura y requiere `SHOP_ADMIN_PASSWORD`. No es aún la integración con las notificaciones
del sistema de gestión. Transferencia y efectivo se muestran como opciones futuras, sin habilitar
su confirmación.

Según confirmó el usuario, las tablas `web_orders` y `web_order_items` ya fueron creadas en
Supabase. Este workspace no ejecutó esa migración ni escribió en la base compartida.

## Autorización de la cuenta vendedora

La integración de pagos usa OAuth de Mercado Pago Marketplace. El dueño de la tienda conecta
su cuenta desde «Pedidos del local»; el comprador no conecta Mercado Pago. El backend crea una
preferencia de Checkout Pro con el token de la cuenta conectada, por lo que el pago se acredita
en esa cuenta. El Access Token y Refresh Token del vendedor se guardan cifrados en
`mp_seller_connections`; la clave de cifrado y las credenciales de la aplicación Marketplace
son variables solo del servidor.

La migración `supabase/migrations/202611200001_mp_oauth_connections.sql` es un borrador aditivo:
agrega metadatos de Mercado Pago a `web_orders` y la tabla aislada de conexiones. No toca
productos, compras existentes ni `shop_purchases`. **No se aplicó desde este workspace.** Debe
revisarse y aplicarse antes de habilitar OAuth.

Para habilitar la prueba, configurar en el servidor `MERCADOPAGO_CLIENT_ID`,
`MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_REDIRECT_URI`, `MP_TOKEN_ENCRYPTION_KEY`,
`MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_APP_URL` y `MERCADOPAGO_TEST_USER_ID`. Las credenciales
de aplicación deben ser de una aplicación Marketplace con la URL de retorno exacta
`/api/mp/oauth/callback`. En modo `test`, solo se acepta el usuario vendedor de prueba cuyo ID
esté configurado; en modo `test` el intercambio OAuth pide credenciales sandbox (`test_token=true`)
y rechaza conexiones que Mercado Pago marque como productivas. Usar cuentas de prueba de Mercado Pago evita cobrar dinero real. El webhook
debe recibir notificaciones de pagos en `/api/orders/webhook`. Para pasar de la cuenta de prueba
a la del negocio, se vuelve a autorizar la nueva cuenta desde el panel; esa conexión queda activa
para las nuevas compras y las anteriores conservan su referencia al vendedor original.

No guardar credenciales privadas ni tokens con prefijo `VITE_`, ni copiarlos al chat o al
repositorio. La configuración local está en `.env.local` (ignorada por Git); Vercel requiere
configurar las mismas variables en el entorno Preview que se use para las pruebas.

La aplicación incluye manifiesto y service worker para instalarla como PWA y abrir una copia
reciente de la interfaz cuando no haya conexión. El catálogo y las cuentas requieren Internet.
