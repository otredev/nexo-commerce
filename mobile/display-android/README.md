# Nexo Pantalla (Android, Tap to Pay)

App de la **pantalla del cliente** del punto de venta con cobro **Tap to Pay** de Stripe: el cliente acerca su
tarjeta o teléfono a la parte trasera del dispositivo. Es la misma pantalla web (`/pantalla`) dentro de una
app nativa (Capacitor) que agrega el lector NFC de Stripe Terminal
(`@capacitor-community/stripe-terminal`). En un navegador normal la pantalla funciona igual, sin tarjeta.

## Cómo funciona

1. La caja crea el cobro (PaymentIntent `card_present`) en la cuenta de Stripe del negocio.
2. La app lo cobra con Tap to Pay (`collectPaymentMethod` + `confirmPaymentIntent`).
3. La caja consulta a Stripe por el servidor si se pagó (nunca confía en el dispositivo) y guarda la venta,
   que el servidor vuelve a verificar con Stripe (`verifyTerminalPayment`).

El token de conexión sale de `POST /api/display/<código>/terminal/token`: el código de emparejamiento de la
caja es la llave, y el token queda limitado a la tienda de esa caja.

## Requisitos

- Dispositivo Android con **NFC**, Google Play Services, sin root ni opciones de depuración inseguras
  (Stripe revisa la integridad del dispositivo). Revisa la lista vigente en la documentación de Stripe:
  Terminal › Tap to Pay on Android.
- Permisos de **ubicación** y **NFC** (Stripe los pide para Tap to Pay).
- En Nexo: plan con cobro con tarjeta, cuenta de Stripe conectada con cobros habilitados, y la tienda
  activada en **Configuración › Integraciones › Cobro con tarjeta en caja**.
- Android Studio (SDK 35) y Node 20.

## Compilar

```bash
cd mobile/display-android
npm install
NEXO_URL=https://nexo-api-staging.nexo-commerce.workers.dev npx cap add android   # solo la primera vez
NEXO_URL=https://nexo-api-staging.nexo-commerce.workers.dev npm run build:debug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Después de `cap add android`, revisa en `android/app/src/main/AndroidManifest.xml` que estén los permisos que
pide el plugin (ubicación, NFC, Bluetooth para lectores físicos) y en `android/variables.gradle` que
`minSdkVersion` sea el que pide la versión del plugin.

En staging (o con `?simulado` en la URL) la app usa el **modo de prueba** de Stripe Terminal. Para
producción compila con `NEXO_URL` del panel de producción y publica con `npm run build:release`.

## Usar

1. En la caja: botón de **monitor › Conectar otro dispositivo**. Aparece un código de 6 dígitos.
2. En la app: escribe el código. Acepta los permisos; la app prepara Tap to Pay y avisa a la caja.
3. Al cobrar con **Tarjeta**, la caja muestra **Cobrar … en la pantalla del cliente**. La app muestra el monto y
   «Acerca tu tarjeta…»; si el banco rechaza, la caja puede **Reintentar** o cobrar de otra forma.
